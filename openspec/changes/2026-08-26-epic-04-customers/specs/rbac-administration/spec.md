# Delta for rbac-administration

## ADDED Requirements

### Requirement: Customer permission catalog seed

The reference seed SHALL create catalog keys `customers.read`,
`customers.create`, `customers.update`, `customers.deactivate`,
`customers.address.manage`, `customers.contact.manage`.

#### Scenario: Catalog contains customer keys

- GIVEN a seeded permission catalog
- WHEN keys are listed
- THEN all six customer keys exist

### Requirement: Customer baseline role matrix

The platform baseline SHALL map customer permissions as follows:

- OWNER and ADMIN: all six keys;
- RECEPTIONIST: `customers.read`, `customers.create`, `customers.update`,
  `customers.address.manage`, `customers.contact.manage`;
- VETERINARIAN: `customers.read` only;
- CASHIER and INVENTORY_MANAGER: none.

Tenant overrides via DEC-003 MAY alter effective sets.

#### Scenario: Owner full access

- GIVEN a seeded OWNER role
- WHEN effective permissions are read
- THEN all six customer keys are present

#### Scenario: Receptionist manage but not deactivate

- GIVEN a seeded RECEPTIONIST role
- WHEN effective permissions are read
- THEN it holds all keys except `customers.deactivate`

#### Scenario: Veterinarian read-only

- GIVEN a seeded VETERINARIAN role
- WHEN effective permissions are read
- THEN it holds exactly `customers.read`

#### Scenario: Cashier no customer access

- GIVEN a seeded CASHIER role
- WHEN effective permissions are read
- THEN it holds no customer keys
