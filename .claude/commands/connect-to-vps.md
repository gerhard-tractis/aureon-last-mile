# Connect to VPS

Display the list of available VPS servers and connect to the selected one via SSH.

## Available VPS Servers

| # | Name | IP | OS | Services |
|---|------|----|----|----------|
| 1 | Hostinger-aureon_LM | 187.77.48.107 | Ubuntu 24.04 | n8n (https://n8n.tractis.ai), OpenClaw |

## Instructions

Ask the user which VPS they want to connect to by showing the table above.

Once the user selects one, verify connectivity by running:
```
ssh root@<IP> "echo connected && uptime && docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

Then confirm the connection is active and show the server status (uptime + running services).

If the user says "all" or doesn't specify, show status for all VPS servers.
