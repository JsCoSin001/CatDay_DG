# B3 deployment: LAN HTTPS + Cloudflare Tunnel

B3 uses the same Laravel backend and the same `QLSX_v02.db` for both access paths.

## LAN

Serve Laravel behind a reverse proxy on a browser-trusted HTTPS hostname, for example `https://factoryflow.local`. Camera access is not supported reliably from an insecure LAN IP URL. The certificate must be trusted by client devices.

## Cloudflare Tunnel

Publish the same Laravel origin through Cloudflare Tunnel. Do not expose the SQLite file or a database port. Example origin mapping:

```yaml
ingress:
  - hostname: factory-test.example.com
    service: https://127.0.0.1:8443
    originRequest:
      # Set this to the hostname covered by the certificate presented by the LAN HTTPS origin.
      originServerName: factoryflow.local
      # Keep TLS verification enabled. For a private CA, configure caPool instead of noTLSVerify.
  - service: http_status:404
```

Keep TLS verification enabled for the origin certificate. When the tunnel service URL uses `127.0.0.1` / `localhost` but the certificate is issued for the LAN hostname, configure `originServerName` to that certificate hostname. If the LAN certificate uses a private CA, configure `caPool` for cloudflared rather than disabling TLS verification.

Configure Laravel trusted proxies / forwarded headers so `X-Forwarded-Proto: https` is honored. Do not hard-code the public hostname in B3 business logic.

## Laravel environment

```env
APP_URL=https://factoryflow.local
SESSION_DRIVER=file
CACHE_STORE=file
QUEUE_CONNECTION=sync
SESSION_SECURE_COOKIE=true
SESSION_HTTP_ONLY=true
SESSION_SAME_SITE=lax
TRUSTED_PROXIES=*
```

If the deployment can restrict the proxy IP ranges, prefer explicit trusted proxy ranges over `*`.

## Database schema

B3 uses the existing FactoryFlow schema in `QLSX_v02.db`. No B3 migration is required. Do not run the Laravel scaffold migrations against the production FactoryFlow database as part of B3 deployment; configure `DB_DATABASE` to the existing database path and verify the schema before starting the application.
