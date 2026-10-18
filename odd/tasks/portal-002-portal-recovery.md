# PORTAL-002 — Portal password recovery (feature tasks)

The gap [[PORTAL-001]] named as its largest: the API's recovery ([[DAT-007]])
authorises a `UserCredential` change and a portal identity holds a
`PortalCredential`, so a customer who forgot their password had no way back.

Everything the flow needs exists on one side or the other and nothing connects
them:

```text
exists          the staff recovery (a single-use hashed token, two public routes, the delivery
                aggregate, the token minted at send time)
                the portal identity (CustomerPortalAccess + PortalCredential, resolved by
                slug + contactEmail + ACTIVE)
                the portal's anonymous layout (PORTAL-001)
does not exist  a token belonging to a PORTAL access rather than a user profile
                a public route on the portal surface — a test today asserts login is the ONLY one
                a message whose recipient is a portal holder
                a page to ask for a reset, and one for the link to land on
```

## The design, derived rather than invented

**A token table of its own.** The staff table's `user_profile_id` foreign key
cannot hold a portal access id, so reuse is impossible without a polymorphic
owner — which would trade referential integrity for the appearance of it. And
[[DEC-008]]'s boundary applies one level down: a staff token must not be
redeemable for a portal password, nor the reverse. Two tables, each with its
subject.

**The recipient is the access's own `contactEmail`.** That is the login id, and
it is the only address whose holder is proven to be the account's owner. The
customer's primary contact may be a DIFFERENT address, and sending the link
there would let a holder of one address reset a session for another. Hence a
`PORTAL_HOLDER` recipient type whose reader resolves the access, rather than
reusing `CUSTOMER`.

**The tenant comes from the slug**, exactly as the portal login resolves it, and
every read is predicated on it.

**Everything else mirrors DAT-007**, because there is no reason to differ:
30-minute single-use hashed tokens with the same four database guards, a uniform
`202`, a rate limit namespaced per identity, the delivery through the aggregate,
and the token minted **at send time** so the plaintext never reaches a table.

## Work units

- [x] **WU-A — the token's data foundation.** `portal_password_reset_token` and
      its guards, plus the two enum values the delivery needs (`PORTAL_ACCOUNT`,
      `PORTAL_HOLDER`). _Done (commit `c199144`): the four guards the staff
      token has — identity fixed at insert, single use with the rewrite and the
      clear refused separately, and `expires_at > created_at` as a CHECK — plus
      the unique digest and a cascade from the access. **No tenant column**,
      deliberately: the access carries the tenant and the read asserts they
      agree, rather than two homes for one fact. 9 schema cases (database 543).
      Proven on a disposable PostgreSQL 16 — all 49 migrations in one pass, and
      the guards refused an expiry before its creation, a duplicate digest, a
      rewritten consumption instant, an un-consume, an extended expiry, a
      repointed digest and a reassigned access, while a fresh token consumed
      once, deleting the access cascaded, and both enum values were usable as
      literals in a later transaction. The first attempt at that run passed
      VACUOUSLY (a `customer` insert failed on a wrong column name, so every
      negative matched no rows); the rerun asserts the access exists first._

-

[ x ]

-
-

W U
-

B

—

t h e

t o k e n

s e r v i c e

a n d

t h e

t w o

r o u t e s . * *

I s s u e

a n d

c o n s u m e ,

t h e

u n i f o r m

a n s w e r

f o r

t h e

f o u r

c a s e s ,

t h e

r a t e

l i m i t ,

t h e

r e s e t ' s

s i n g l e

t r a n s a c t i o n ,

a n d

t h e

r o u t e
-

c o n t r a c t

t e s t

t h a t

c u r r e n t l y

s a y s

l o g i n

i s

t h e

o n l y

p u b l i c

p o r t a l

r o u t e .

-

D o n e :

`P o r t a l P a s s w o r d R e s e t T o k e n S e r v i c e`

( i s s u e / c o n s u m e

w i t h

t h e

C A S / s p e n d A l l F o r A c c e s s )

a n d

`P o r t a l P a s s w o r d R e c o v e r y S e r v i c e`

( t h e

r e q u e s t

p u b l i s h i n g

a n

e v e n t ,

t h e

r e s e t

i n

O N E

t r a n s a c t i o n

w i t h

t h e

h a s h

c o m p u t e d

b e f o r e

i t

o p e n s ) ,

t h e

t w o

`@ P u b l i c`

r o u t e s ,

a n d

t h e

f e n c e

i n v e r t e d

—

` e x p e c t ( p u b l i c P o r t a l ) . t o E q u a l ( [ " P O S T

/ p o r t a l / l o g i n " ] ) `

b e c a m e

t h e

t h r e e

p u b l i c

r o u t e s ,

w i t h

t h e

i n v a r i a n t

w o r t h

k e e p i n g

s t a t e d :

n o

O T H E R

p o r t a l

r o u t e

i s

p u b l i c .

1 7

n e w

c a s e s

( 8

t o k e n ,

9

r e c o v e r y )

p l u s

4

o v e r

r e a l

H T T P ,

i n c l u d i n g

t h e

b y t e
-

i d e n t i c a l

a n s w e r

f o r

a

h o l d e r ,

a

s t r a n g e r

a n d

a n

u n k n o w n

t e n a n t .

a p i

1 3 4 4 . *

-
-

T w o

t h i n g s

t h e

w o r k

s u r f a c e d . * *

( 1 )

T h e

a u d i t

b o u n d a r y

R E F U S E D

` a c t o r T y p e :

" P O R T A L " `

f o r

a n

a n o n y m o u s

r e q u e s t

—

" P O R T A L

a t t r i b u t i o n

r e q u i r e s

a

p o r t a l

a c c e s s

i d "

—

a n d

i t

i s

r i g h t :

t h e

r e q u e s t e r

i s

n o b o d y

a u t h e n t i c a t e d ,

s o

t h e

r e c o r d

a t t r i b u t e s

t o

t h e

A C C E S S

a s

t h e

s u b j e c t ,

e x a c t l y

a s

t h e

s t a f f

f l o w

a t t r i b u t e s

i t s

r e q u e s t

t o

t h e

p r o f i l e .

( 2 )

T h e

i n
-

m e m o r y

h a r n e s s

n e e d e d

t h e

t o k e n

d e l e g a t e ,

`p o r t a l C r e d e n t i a l . u p d a t e`

a n d

`p o r t a l S e s s i o n . d e l e t e M a n y`

b y

a c c e s s ;

i t

i s

t h e

f i f t h

t i m e

t h i s

s e s s i o n

t h a t

t h e

h a r n e s s

w a s

t h e

g a p .

- [ ] **WU-C — the delivery.** The portal-holder recipient reader, a
      `PORTAL_ACCOUNT` branch in the content builder that mints the token and
      builds the link with the tenant's slug, and the scheduler reaction.
- [ ] **WU-D — the two pages.** `/[slug]/forgot-password` and
      `/[slug]/reset-password`, and the link on the login form whose comment
      currently explains its absence.
- [ ] **WU-E — the documentation and the closure.** `Portal.md`,
      `Notifications.md`, `Identity-Sessions.md`, and the Story's evidence.

## The one thing this Story must not do

**Widen the staff flow.** DAT-007 stands as it is; a shared token table or a
shared route would make the two identities' credentials interchangeable exactly
where the repository says they are not.
