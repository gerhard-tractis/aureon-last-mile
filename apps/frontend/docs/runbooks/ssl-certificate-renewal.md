# Runbook: SSL Certificate Renewal

**Alert Type:** SSL Certificate Expiring Soon
**Severity:** Medium (High if <3 days to expiration)
**SLA:** Renew within 7 days of alert

---

## Alert Trigger

**Condition:** SSL certificate expires in <7 days

**Example Alert:**
```
[BetterStack Alert] SSL Certificate Expiring Soon
Domain: app.aureon.com
Expires: 2026-03-01 12:00:00 UTC (6 days remaining)
Issuer: Let's Encrypt
```

---

## Overview

**Hosting:** Vercel
**Domain:** aureon.com, app.aureon.com
**Certificate Provider:** Let's Encrypt (via Vercel)
**Auto-Renewal:** Yes (Vercel handles automatically)

**Note:** Vercel automatically renews Let's Encrypt certificates. This runbook is for troubleshooting when auto-renewal fails.

---

## Immediate Actions (When Alert Received)

### 1. Check Current Certificate Status

**Via Browser:**
1. Visit https://app.aureon.com
2. Click padlock icon in address bar
3. View certificate details
4. Check expiration date

**Via Command Line:**
```bash
# Check SSL certificate expiration
echo | openssl s_client -servername app.aureon.com -connect app.aureon.com:443 2>/dev/null \
  | openssl x509 -noout -dates

# Expected output:
# notBefore=Feb  1 12:00:00 2026 GMT
# notAfter=May  1 12:00:00 2026 GMT
```

### 2. Verify Vercel Auto-Renewal Status

**Vercel Dashboard:**
1. Login to [vercel.com](https://vercel.com)
2. Navigate to: Project Settings → Domains
3. Check domain status:
   - ✅ Valid certificate (auto-renewal working)
   - ⚠️ Certificate expiring (auto-renewal may have failed)
   - ❌ Certificate invalid (immediate action required)

---

## Troubleshooting Auto-Renewal Failures

### Common Causes

**1. DNS Configuration Issues**

**Symptoms:**
- Domain shows "DNS Misconfigured" in Vercel
- Certificate renewal failed

**Check DNS:**
```bash
# Check A record
dig app.aureon.com A +short

# Check CNAME
dig app.aureon.com CNAME +short
```

**Expected:**
- A record pointing to Vercel IP (76.76.21.21)
- OR CNAME pointing to Vercel deployment (cname.vercel-dns.com)

**Fix:**
1. Login to domain registrar (e.g., GoDaddy, Namecheap)
2. Update DNS records to point to Vercel
3. Wait for DNS propagation (up to 24 hours)
4. Trigger manual renewal in Vercel dashboard

**2. CAA Records Blocking Let's Encrypt**

**Check CAA records:**
```bash
dig aureon.com CAA +short
```

**Expected:**
- No CAA records
- OR CAA record allowing Let's Encrypt: `0 issue "letsencrypt.org"`

**If blocked:**
1. Add CAA record in DNS: `0 issue "letsencrypt.org"`
2. Wait 1 hour for propagation
3. Trigger manual renewal

**3. Rate Limiting (Let's Encrypt)**

**Limits:**
- 50 certificates per domain per week
- 5 duplicate certificates per week

**Check:**
- Vercel renewal logs show "rate limit exceeded"

**Fix:**
- Wait for rate limit window to reset (1 week)
- Avoid triggering manual renewals repeatedly

---

## Manual Renewal (If Auto-Renewal Failed)

### Via Vercel Dashboard

1. Login to Vercel
2. Project Settings → Domains
3. Find domain: app.aureon.com
4. Click "Renew Certificate" button
5. Wait 2-5 minutes for renewal
6. Verify new expiration date

### Via Vercel CLI

```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Login
vercel login

# Renew certificate
vercel certs renew app.aureon.com
```

---

## Emergency: Certificate Already Expired

**Impact:**
- Users see "Your connection is not private" warning
- Application inaccessible to most users
- Severe SEO and trust impact

**Immediate Actions (< 1 hour):**

### 1. Enable Vercel's Automatic HTTPS (if disabled)

Vercel Dashboard → Project Settings → Domains → Enable "Automatic HTTPS"

### 2. Force Certificate Issuance

```bash
# Remove and re-add domain
vercel domains rm app.aureon.com
vercel domains add app.aureon.com
```

This triggers immediate certificate issuance.

### 3. Temporary: Use Vercel's Free Domain

If custom domain renewal failing:
```bash
# Deploy with Vercel's free domain
vercel --prod

# Share temporary URL: your-project.vercel.app
# This has valid SSL while fixing custom domain
```

**Communicate to users:**
```
Temporary access: https://aureon-last-mile.vercel.app
We're resolving SSL certificate issues on our main domain.
ETA: [1-2 hours]
```

---

## Communication

### Internal

**Slack #devops:**
```
⚠️ SSL certificate renewal alert for app.aureon.com
Expires: [date] ([X] days remaining)
Status: [Investigating / Renewing / Resolved]
Action: [Triggering manual renewal / Fixing DNS / Waiting for Let's Encrypt]
ETA: [time]
```

### External (If Certificate Expired)

**Status Page:**
```
🔒 SSL Certificate Issue
We're experiencing SSL certificate issues affecting access to
app.aureon.com. Our team is actively working to resolve this.

Temporary Access: https://aureon-last-mile.vercel.app
ETA: 1-2 hours
Last Update: [time]
```

---

## Verification After Renewal

### 1. Check New Expiration Date

```bash
echo | openssl s_client -servername app.aureon.com -connect app.aureon.com:443 2>/dev/null \
  | openssl x_509 -noout -dates
```

**Expected:**
- `notAfter` date is ~90 days in future

### 2. Test HTTPS Access

**Via Browser:**
- Visit https://app.aureon.com
- Verify padlock icon shows valid certificate
- No security warnings

**Via curl:**
```bash
curl -I https://app.aureon.com
# Should return HTTP/2 200 OK without SSL errors
```

### 3. Update BetterStack Monitoring

- Verify BetterStack SSL check shows new expiration date
- Confirm alert is cleared

---

## Prevention

### 1. Enable Vercel Auto-Renewal (if not enabled)

Vercel Dashboard → Project Settings → Domains → "Automatic HTTPS" toggle ON

### 2. Set Up Monitoring

**BetterStack:**
- Monitor: SSL certificate expiration
- Alert threshold: 7 days
- Escalation: Email → SMS (if <3 days)

### 3. Regular Health Checks

**Monthly:**
- Check Vercel domain status
- Verify auto-renewal logs
- Review DNS configuration

**Quarterly:**
- Test manual renewal process
- Review this runbook
- Update contact information

---

## Escalation

**Escalate if:**
- Certificate expired and manual renewal failing >2 hours
- DNS propagation issues persist >24 hours
- Let's Encrypt rate limit exceeded and approaching expiration

**Escalation Contacts:**
- Vercel Support: support@vercel.com (via dashboard)
- Domain Registrar Support: [Contact for your registrar]
- Tech Lead: [Contact info]

---

## Related Documentation

- [Vercel SSL Certificates](https://vercel.com/docs/concepts/projects/custom-domains#ssl)
- [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/)
- [CAA Records](https://letsencrypt.org/docs/caa/)

---

## Notes

- Vercel uses Let's Encrypt for automatic SSL
- Certificates auto-renew at 30 days before expiration
- Renewal is retry-friendly (multiple attempts if first fails)
- No manual intervention needed in 99% of cases
- This runbook is for the 1% edge cases
