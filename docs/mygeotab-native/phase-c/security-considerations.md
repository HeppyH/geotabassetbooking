# Security Considerations
- Store never sees the raw api; denied capabilities fail before any network call.
- Stored data is untrusted: every record is validated; malformed, oversized, foreign or duplicate records are rejected and reported, not rendered.
- `createdBy` is recorded but is client-supplied; it is not proof of authorship. AddInData clearances are per method, not per record (see identity docs, Phase D).
- Remove disabled by default. No localStorage use (tested). No logging of record content.
