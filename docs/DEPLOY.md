# Deploying with Dokploy

Target: **https://pigmentdrift.ossianravn.dev**, as a Dokploy **Application** built from this repository's `Dockerfile`.

The site is fully static: nginx serves the built files, and all rendering and exporting happens in the visitor's browser. There are no environment variables, volumes or databases.

## 1. DNS

Point an **A** record for `pigmentdrift.ossianravn.dev` at the Dokploy server. Ports 80 and 443 must be open for Traefik routing and Let's Encrypt certificates. If there is an AAAA record, it must point at the server's working IPv6 address.

## 2. Application

In a Dokploy project, create an **Application** named `pigment-drift`. Under **General → Provider**, set:

| Setting | Value |
| --- | --- |
| Provider | GitHub |
| Repository | `ossianravn/pigment-drift-generator` |
| Branch | `main` |
| Build path | `/` |
| Build type | **Dockerfile** |
| Dockerfile path | `Dockerfile` |
| Docker context path | `.` |
| Docker build stage | leave empty |

If the repository doesn't show up in the selector, the Dokploy GitHub App only has access to selected repositories. Add this one under GitHub → Settings → Applications → (your Dokploy app) → Repository access. The repository is public, so the plain **Git** provider with `https://github.com/ossianravn/pigment-drift-generator.git` also works.

Leave the start command empty, and leave **Environment** and **Volumes** empty.

## 3. Domain

Under **Domains**, add:

| Setting | Value |
| --- | --- |
| Host | `pigmentdrift.ossianravn.dev` |
| Path | `/` |
| Container port | **80** |
| HTTPS | On |
| Certificate | Let's Encrypt |

Leave **Advanced → Ports** empty; Traefik routes the domain to port 80 inside the container.

## 4. Deploy

Click **Deploy**. With **Autodeploy** on (General), every push to `main` redeploys.

Check:

- `https://pigmentdrift.ossianravn.dev/healthz` → `ok` (the container health check uses this too).
- `https://pigmentdrift.ossianravn.dev/embed/pigment-drift.min.js` loads, with `Access-Control-Allow-Origin: *`.
- The generator opens, animates, and **Export → Live embed → Script → Load it from pigmentdrift.ossianravn.dev** produces a hot-linkable snippet.

## Caching

nginx serves fingerprinted `/assets/*` as immutable for a year, `/embed/*` for an hour (keep that path stable, since other sites may hot-link it), and `index.html` with `no-cache`, so deploys show up immediately.
