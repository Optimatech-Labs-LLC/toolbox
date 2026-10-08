# Optimatech Labs Toolbox

Free, single-purpose tools that run entirely in your browser. Nothing you drop into a tool is sent anywhere, and that is enforced by your browser, not promised by us.

Live at https://optimatechlabs.com/tools/ . Source: https://github.com/Optimatech-Labs-LLC/toolbox

## Tools

| Tool | What it does | Status |
| --- | --- | --- |
| [Evidence hash](evidence-hash/) | SHA-256, SHA-1 and MD5 for files of any size, with a receipt you can attach to a report | 1.0.1 |
| [Metadata scrubber](metadata-scrubber/) | See and strip hidden metadata in JPEG, PNG, WebP, PDF, DOCX, XLSX and PPTX files without re-encoding | 1.0.0 |
| [Spreadsheet pseudonymizer](pseudonymizer/) | Replace identifying columns in a CSV with consistent pseudonyms keyed to your passphrase, with a re-identification warning | 1.0.0 |
| [Redactor](redactor/) | Find and redact or pseudonymize personal data in text and .docx, with checksum-verified card, IBAN and routing numbers | 1.0.0 |
| [Tiny LLM](tiny-llm/) | Train a small character-level transformer on your own text in a browser worker, watch the loss fall, generate text, save the weights. A port of [feel-smart-llm](https://github.com/Optimatech-Labs-LLC/feel-smart-llm) | 1.0.0 |

## How the "runs in your browser" claim is enforced

Every tool page carries this Content Security Policy in a `<meta>` tag in the page source, where the browser enforces it. A server with `mod_headers` can also send it as a header (see Deploying); optimatechlabs.com currently serves it in the page only, so the header-only directive `frame-ancestors` does not apply there:

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src blob: data:; worker-src 'self' blob:; media-src blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; webrtc 'block'
```

`connect-src blob: data:` means the page's code cannot open a connection to any host. `form-action 'none'` means no form can submit anywhere. The browser enforces both.

Each tool has a "Prove it" button that tries to send data out five different ways and shows you the browser refusing each one. Switch off your network and the tool keeps working. Every script and stylesheet carries an integrity hash, and `release.txt` in each tool folder lists the hashes of the files that make up that release.

Known limits, stated plainly: a browser extension can read any page you open; the policy cannot stop a page from navigating you to another site, which you would see; browsers do not yet enforce the `webrtc` rule, which is why this code is public and contains no WebRTC; the time on a receipt is your computer's clock.

See [verify/](verify/) for the "Check it yourself" page.

## Rules for every tool in this repo

- No network calls, no third-party scripts, no CDN, no web fonts, no analytics, no cookies.
- No inline scripts or styles; the policy forbids them. All code lives in `.js` and `.css` files.
- Plain files, no build step beyond `build/release.py`, which computes integrity hashes and writes `release.txt`. Tests in `test/` run with Node and compare against OpenSSL and zlib: `node test/hash_test.js`, `node test/zipkit_test.js`, `node test/scrub_test.js`, `node test/detect_test.js`, `node test/llm_test.js`. Every tool page also runs an automated check when opened with `?selftest=1`.
- Shared layout and the proof panel come from `shell/`.

## Deploying

Copy a tool folder and `shell/` to the `tools/` directory of the site. The policy in each page works on its own. To also send it as a header, Apache needs `mod_headers` and either `shell/tools.htaccess` (renamed to `.htaccess` in `tools/`, with AllowOverride) or `shell/apache-tools.conf` inside the virtual host. Then check from outside:

```bash
curl -sI https://optimatechlabs.com/tools/evidence-hash/ | grep -i content-security-policy
```

## License

MIT. Copyright (c) 2026 Optimatech Labs LLC.
