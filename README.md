# DDC CRM Public Demo

A browser-based CRM evaluation for DDC Sprocket's Agriculture workflows. It uses
synthetic companies, contacts, products, and sales activity. The interface defaults
to Thai and offers English in the language menu.

Built on [Atomic CRM](https://github.com/marmelab/atomic-crm) under the MIT
license. See [LICENSE.md](LICENSE.md) and [README.atomic-crm.md](README.atomic-crm.md).

## Run locally

Use Node.js 24 and run:

```bash
npm ci
npm run dev:demo
```

Open [localhost:5174](http://localhost:5174). Browser edits are saved in
IndexedDB for the current origin and browser profile. Demo identities are local
test accounts. To switch roles, sign out and select an available demo account
using the password `demo`.

## Verify the Pages build

```bash
node scripts/check-public-demo.mjs
npm run build:demo
node scripts/check-public-demo.mjs --dist
npm run preview -- --config vite.demo.config.ts
```

If the repository's GitHub plan supports Pages, enable **GitHub Actions** as
the Pages source in repository settings. Run **Deploy public CRM demo** from
the Actions tab on `main`. The workflow builds and checks the static
`dist/` directory before uploading it to GitHub Pages. Repository visibility
and Pages site visibility are separate settings.
