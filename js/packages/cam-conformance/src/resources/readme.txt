This facet owns resource inventory and integrity across a CAM bundle: declared
resources, missing resources, orphan resources, URI policy, size caps, hash
policy, and resource-type expectations.

It operates on bytes already supplied by the caller, not fetched resources.
Fetching policy belongs to the caller; resource conformance starts after bytes
cross that boundary and must still enforce the shared protocol size and
integrity rules.
