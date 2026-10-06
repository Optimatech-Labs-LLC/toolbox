/* Checks the redactor's checksums and patterns. Run: node test/detect_test.js */
'use strict';
const D = require('../redactor/detect.js'); let fails = 0;
const check = (l, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + l + (ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)); };
check('luhn valid visa', D.luhn('4111111111111111'), true); check('luhn invalid', D.luhn('4111111111111112'), false);
check('iban valid GB', D.ibanOk('GB82 WEST 1234 5698 7654 32'), true); check('iban valid DE', D.ibanOk('DE89370400440532013000'), true); check('iban invalid', D.ibanOk('GB82 WEST 1234 5698 7654 33'), false);
check('aba valid', D.abaOk('011000015'), true); check('aba invalid checksum', D.abaOk('011000016'), false); check('aba invalid prefix', D.abaOk('990000000'), false);
const t = 'Dr. Jane Doe (jane.doe@example.com, +1 401-555-0199) paid with card 4111 1111 1111 1111 on 05/10/2026. IBAN GB82 WEST 1234 5698 7654 32, routing 011000015, SSN 219-09-9999, from 192.168.1.7. Client: Robert Smith of Acme Holdings LLC. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789. Random 123456789012 and 999999999 should not match. Ref CASE-2026-0417 twice: case-2026-0417.';
const m = D.detect(t, { customTerms: ['CASE-2026-0417'] });
check('types found', m.map(x => x.type), ['name','email','phone','card','date','iban','routing','ssn','ipv4','name','org','secret','custom','custom']);
check('no overlap', m.every((x, i) => i === 0 || x.start >= m[i - 1].end), true);
const out = D.apply(t, m, 'pseudonym');
check('pseudonyms consistent for custom term', (out.text.match(/TERM-1/g) || []).length, 2);
check('labels mode', D.apply('mail me@x.io now', D.detect('mail me@x.io now'), 'label').text, 'mail [EMAIL] now');
check('kept match honoured', D.apply('mail me@x.io now', D.detect('mail me@x.io now').map(x => Object.assign(x, { off: true })), 'label').text, 'mail me@x.io now');
check('org keeps sentence period', /ORG-1\. Token/.test(out.text), true);
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed'); process.exit(fails ? 1 : 0);
