---
type: roadmap
status: active
updated: 2026-08-24
---

# ROADMAP

| Epic    | Name                               |      Status | Depends on                |
| ------- | ---------------------------------- | ----------: | ------------------------- |
| EPIC-00 | Foundation                         |       ready | —                         |
| EPIC-01 | Database/Auth/Tenancy              | in-progress | EPIC-00                   |
| EPIC-02 | RBAC/Entitlements/Tenant Settings  |     planned | EPIC-01                   |
| EPIC-03 | Staff Shell/Design System/Branding |     planned | EPIC-01                   |
| EPIC-04 | Customers                          |     planned | EPIC-02, EPIC-03          |
| EPIC-05 | Veterinary Patients                |     planned | EPIC-04                   |
| EPIC-06 | Clinical                           |     planned | EPIC-05                   |
| EPIC-07 | Scheduling                         |     planned | EPIC-04, EPIC-05          |
| EPIC-08 | Portal                             |     planned | EPIC-04, EPIC-05, EPIC-07 |
| EPIC-09 | Catalog/Taxes                      |     planned | EPIC-02                   |
| EPIC-10 | Inventory                          |     planned | EPIC-09                   |
| EPIC-11 | Suppliers/Purchases                |     planned | EPIC-10                   |
| EPIC-12 | POS/Payments                       |     planned | EPIC-09, EPIC-10          |
| EPIC-13 | Cash                               |     planned | EPIC-12                   |
| EPIC-14 | Billing                            |     planned | EPIC-12                   |
| EPIC-15 | Fiscal Abstraction                 |     planned | EPIC-14                   |
| EPIC-16 | Fiscal Third-party Adapter         |     planned | EPIC-15                   |
| EPIC-17 | Notifications                      |     planned | EPIC-07                   |
| EPIC-18 | Dashboards/Reports                 |     planned | prior domains             |
| EPIC-19 | Imports                            |     planned | EPIC-04, EPIC-05          |
| EPIC-20 | Production Hardening               |     planned | MVP feature epics         |

Update this table when Epic status changes.

Individual Stories live in `../02-stories/`.

## Architecture baseline

Architecture freeze: PRD v1.3. Structural changes require an accepted ADR.
