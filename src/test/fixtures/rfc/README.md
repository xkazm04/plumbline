Test vectors copied from published RFCs, read from https://www.rfc-editor.org/ on 2026-11-18. Each file is the RFC's
text as printed, so a test can hold Plumbline to it without fetching anything.

| File | Source |
| --- | --- |
| `rfc8037-a4.json` | RFC 8037 (CFRG ECDH and Signatures in JOSE), Appendix A.1 (the Ed25519 key as a JWK) and A.4 (Ed25519 signing: the protected header `{"alg":"EdDSA"}`, the payload "Example of Ed25519 signing", their base64url forms and the signature) |
| `rfc8785-sample.input.json` | RFC 8785 (JSON Canonicalization Scheme), section 3.2.2: the sample input, exactly as printed |
| `rfc8785-sample.canonical.txt` | RFC 8785, section 3.2.3: the canonical form of that sample (the RFC's display line wrap removed), UTF-8, no trailing newline |
| `rfc8785-sorting.input.json` | RFC 8785, section 3.2.3: the property-sorting test data; the expected order of its values is in the test |
