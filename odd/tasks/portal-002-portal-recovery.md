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

-

[ x ]

-
-

W U
-

C

—

t h e

d e l i v e r y . * *

T h e

p o r t a l
-

h o l d e r

r e c i p i e n t

r e a d e r ,

a

`P O R T A L _ A C C O U N T`

b r a n c h

i n

t h e

c o n t e n t

b u i l d e r

t h a t

m i n t s

t h e

t o k e n

a n d

b u i l d s

t h e

l i n k

w i t h

t h e

t e n a n t ' s

s l u g ,

a n d

t h e

s c h e d u l e r

r e a c t i o n .

-

D o n e :

` p o r t a l
-

r e c o v e r y . p o l i c y . t s `

( t h e

c h a n n e l ,

t h e

h o u r

w i n d o w ,

t h e

k e y

p e r

A C C E S S

a n d

`p o r t a l R e c o v e r y U r l`

w i t h

t h e

s l u g

i n

t h e

P A T H ) ,

t h e

r e a d e r ' s

`P O R T A L _ H O L D E R`

b r a n c h

r e s o l v i n g

t h e

a c c e s s ' s

O W N

`c o n t a c t E m a i l`

t e n a n t
-

p r e d i c a t e d ,

t h e

b u i l d e r ' s

`P O R T A L _ A C C O U N T`

b r a n c h

g a t i n g

o n

A C T I V E

-

a

c r e d e n t i a l ,

m i n t i n g

t h e

t o k e n

a t

s e n d

t i m e

a n d

r e a d i n g

t h e

t e n a n t ' s

s l u g

f o r

t h e

l i n k ,

a n d

`P o r t a l P a s s w o r d R e c o v e r y S c h e d u l e r`

—

w h i c h

n e e d s

N O

r e a d

o f

i t s

o w n ,

b e c a u s e

t h e

s o u r c e

a n d

t h e

r e c i p i e n t

a r e

t h e

a c c e s s

i d

t h e

e v e n t

c a r r i e s

a n d

t h e

W O R K E R

g a t e s

a t

s e n d

t i m e .

-
-

T h e

t w o

g u a r d s

m i r r o r

e a c h

o t h e r

a n d

b o t h

a r e

r i g h t * * :

t h e

s t a f f

s c h e d u l e r

r e f u s e s

a

T E N A N T
-

s c o p e d

e v e n t

b e c a u s e

i t s

m e s s a g e

i s

p l a t f o r m
-

o w n e d ,

a n d

t h i s

o n e

r e f u s e s

a n

e v e n t

w i t h

N O

t e n a n t

b e c a u s e

a

p o r t a l

m e s s a g e

m u s t

b e l o n g

t o

a

c l i n i c .

1 2

n e w

c a s e s

( 2

r e a d e r ,

2

b u i l d e r ,

5

s c h e d u l e r )

p l u s

t h e

p o l i c y ' s

o w n .

a p i

1 3 4 9 ,

w o r k e r

2 4 5 .

-
-

A n d

a

n a m i n g

d e b t

r e c o r d e d

r a t h e r

t h a n

r e n a m e d * * :

t h e

b u i l d e r

r e u s e s

`S T A F F _ A P P _ B A S E _ U R L`

f o r

t h e

p o r t a l ' s

l i n k ,

b e c a u s e

o n e

w e b

a p p

s e r v e s

b o t h

s u r f a c e s .

R e n a m i n g

t h e

d e p l o y m e n t

i n p u t

w o u l d

b r e a k

e v e r y

e x i s t i n g

d e p l o y m e n t

f o r

a

w o r d .

- [ ] **WU-D — the two pages.** `/[slug]/forgot-password` and
      `/[slug]/reset-password`, and the link on the login form whose comment
      currently explains its absence.
- [ ] **WU-E — the documentation and the closure.** `Portal.md`,
      `Notifications.md`, `Identity-Sessions.md`, and the Story's evidence.

## The one thing this Story must not do

**Widen the staff flow.** DAT-007 stands as it is; a shared token table or a
shared route would make the two identities' credentials interchangeable exactly
where the repository says they are not.
