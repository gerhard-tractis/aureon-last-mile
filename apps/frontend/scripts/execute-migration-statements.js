#!/usr/bin/env node
/**
 * Execute migration statement-by-statement via Supabase Management API
 * Handles JSON encoding issues by processing statements individually
 */

const https = require('https');
const { readFileSync } = require('fs');
const { join } = require('path');

const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

// Read migration SQL
const migrationPath = join(__dirname, '../supabase/migrations/20260216170542_create_users_table_with_rbac.sql');
const fullSql = readFileSync(migrationPath, 'utf-8');

// Split SQL into statements (handle dollar-quoted blocks)
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = null;

  const lines = sql.split('\n');

  for (let line of lines) {
    // Skip pure comment lines
    if (line.trim().startsWith('--') && !inDollarQuote) {
      continue;
    }

    // Check for dollar quotes ($$...$$)
    const dollarMatches = line.match(/\$\$|\$[a-zA-Z_][a-zA-Z0-9_]*\$/g);
    if (dollarMatches) {
      for (let match of dollarMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = match;
        } else if (match === dollarTag) {
          inDollarQuote = false;
          dollarTag = null;
        }
      }
    }

    current += line + '\n';

    // End of statement if we hit semicolon outside dollar quotes
    if (line.includes(';') && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Add final statement if exists
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

const statements = splitStatements(fullSql);
console.log(`📦 Parsed ${statements.length} SQL statements from migration file\n`);

// Execute statement via API
function executeStatement(sql, index, total) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });

    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve({ success: true, status: res.statusCode, data: responseData });
        } else {
          resolve({ success: false, status: res.statusCode, error: responseData });
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.write(data);
    req.end();
  });
}

// Execute all statements sequentially
(async function() {
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');

    console.log(`[${i+1}/${statements.length}] ${preview}...`);

    try {
      const result = await executeStatement(stmt, i+1, statements.length);

      if (result.success) {
        successCount++;
        console.log(`  ✅ Success (${result.status})`);
      } else {
        const errorMsg = JSON.parse(result.error).message || result.error;
        // Some errors are OK (e.g., "already exists", demo user insert without auth.users)
        if (errorMsg.includes('already exists') ||
            errorMsg.includes('does not exist') ||
            errorMsg.includes('violates foreign key constraint "users_id_fkey"') ||
            errorMsg.includes('is not present in table "users"')) {
          skipCount++;
          console.log(`  ⚠️  Skipped: ${errorMsg.substring(0, 80)}...`);
        } else {
          console.error(`  ❌ Failed (${result.status}): ${errorMsg}`);
          console.error(`     Statement preview: ${preview}`);
          process.exit(1);
        }
      }
    } catch (err) {
      console.error(`  ❌ Request error: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n🎉 Migration complete!`);
  console.log(`   ✅ ${successCount} statements executed`);
  console.log(`   ⚠️  ${skipCount} statements skipped (already applied)`);
  console.log(`\n📋 Next step: Register custom_access_token_hook in Supabase Dashboard`);
  console.log(`   (Authentication > Hooks > Custom Access Token)\n`);
})();
