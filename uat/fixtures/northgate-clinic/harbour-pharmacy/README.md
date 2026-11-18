# Harbour Pharmacy: signature check

Harbour Pharmacy's site hands patients over to Northgate Clinic's assistant. Before it does, it checks the clinic's
Plumbline signature against this folder's `plumbline.trust.json`, which starts empty: the pharmacy has not yet decided
to trust any key.

The clinic's address in this world is in the JSON map `up` printed (`sites[].address` for `northgate-clinic`).
