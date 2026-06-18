Resource conformance belongs here.

This facet should validate resource inventory and integrity across a CAM bundle:
declared resources, missing resources, orphan resources, URI policy, size caps,
hash policy, and resource-type expectations.

It should operate on bytes already supplied by the caller, not fetch resources.
Fetching policy belongs to the caller; resource conformance starts after bytes
cross that boundary and must still enforce the same size and integrity rules the
runtime applies.
