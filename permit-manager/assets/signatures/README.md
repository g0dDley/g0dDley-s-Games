# Signature assets (LOCAL ONLY — never committed)

Signature PNGs live in this folder but are **gitignored** — they are sensitive
and must not be pushed to the repository. Only this README is tracked.

Because they are not in git, they live on your machine only. If you move to a
fresh checkout/environment you must place them here again.

## What goes here

Transparent-background PNGs of the signatures you are **authorized** to apply,
named to match each party's `signature_asset` path in the project profile:

| File                     | Signer / mark                                  |
|--------------------------|------------------------------------------------|
| `nick_swerdfeger.png`    | Nick Swerdfeger — OAA seal + signature (arch)  |
| `david_bovill.png`       | David Bovill — signature (structural)          |
| `doug_mclaughlin.png`    | Doug McLaughlin — signature (structural, alt)  |

A profile entry references one like:

```json
{ "name": "Nick Swerdfeger", "signature_authorized": true,
  "signature_asset": "assets/signatures/nick_swerdfeger.png" }
```

If an asset is missing at fill time, the tool does **not** guess — it leaves the
signature blank and reports the block as awaiting a signature.

## Preparing a new signature

Provide a scan/PDF of the signature (or seal). It is cropped, white background
made transparent, form rules removed, and normalized to a consistent ink
darkness so all signatures read with similar weight. Keep the background
transparent and the ink dark.
