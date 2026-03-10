const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '../apps/worker/n8n/workflows/beetrack-excel-import.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

// Remove the two delivery_attempts nodes
wf.nodes = wf.nodes.filter(n => n.id !== 'bt-map-delivery-attempts' && n.id !== 'bt-upsert-delivery-attempts');

// Fix bt-link-packages: revert to $input.all()
const linkPkg = wf.nodes.find(n => n.id === 'bt-link-packages');
linkPkg.parameters.jsCode = `// Map order_number -> order_id from UPSERT Orders response
const orders = $input.all().map(item => item.json);
const packages = $('Map & Validate').first().json.packages;

const orderIds = {};
for (const o of orders) {
  if (o.order_number && o.id) {
    orderIds[o.order_number] = o.id;
  }
}

const linked = packages
  .filter(p => orderIds[p.order_number])
  .map(p => ({
    operator_id: p.operator_id,
    order_id: orderIds[p.order_number],
    label: p.label,
    sku_items: p.sku_items,
    raw_data: p.raw_data
  }));

return [{ json: {
  packages: linked,
  orders_upserted: orders.length,
  packages_count: linked.length
}}];`;

// Fix bt-prepare-summary: revert to original (no delivery_attempts fields)
const summary = wf.nodes.find(n => n.id === 'bt-prepare-summary');
summary.parameters.jsCode = `const mapData = $('Map & Validate').first().json;
const linkData = $('Link Packages').first().json;
const jobId = $('Create Job Record').first().json.id;

return [{ json: {
  job_id: jobId,
  patch_body: {
    status: 'completed',
    completed_at: new Date().toISOString(),
    result: {
      rows_processed: mapData.rows_processed,
      orders_upserted: linkData.orders_upserted,
      packages_inserted: linkData.packages_count,
      rows_skipped: mapData.rows_skipped,
      errors: mapData.errors
    }
  }
}}];`;

// Fix connections: UPSERT Orders -> Link Packages directly
delete wf.connections['Map Delivery Attempts'];
delete wf.connections['UPSERT Delivery Attempts'];
wf.connections['UPSERT Orders'] = {
  main: [[{ node: 'Link Packages', type: 'main', index: 0 }]]
};

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));

// Verify
console.log('Nodes:', wf.nodes.length);
console.log('Has bt-map-delivery-attempts:', wf.nodes.some(n => n.id === 'bt-map-delivery-attempts'));
console.log('Has bt-upsert-delivery-attempts:', wf.nodes.some(n => n.id === 'bt-upsert-delivery-attempts'));
console.log('UPSERT Orders ->', JSON.stringify(wf.connections['UPSERT Orders']));
console.log('Link Packages code starts:', linkPkg.parameters.jsCode.substring(0, 60));
console.log('Prepare Summary code starts:', summary.parameters.jsCode.substring(0, 60));
console.log('Done.');
