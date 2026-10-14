-- Données IDF Invest fictives pour tester la reprise (format réel de l'ancienne application).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bruno@example.test');

insert into public.simulations (id, user_id, number, version, archived, data, created_at, updated_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'SIM-2026-0001', 1, false,
  '{"title":"T2 Montreuil","status":"Visite programmée","propertyType":"Appartement","address":"12 rue de Paris","zip":"93100","city":"Montreuil","surface":42,"rooms":2,"dpe":"D","listingUrl":"https://example.test/annonce/1","comments":"Lumineux","agency":"Agence du Parc","agentName":"Claire Martin","agentEmail":"Claire.Martin@agence.test","agentPhone":"0600000000","askingPrice":230000,"offerPrice":215000,"notaryFees":16125,"agencyFees":10000,"works":8000,"furniture":0,"financeFees":2500,"downPayment":30000,"interestRate":3.5,"loanYears":20,"insuranceRate":0.3,"rentM2Low":22,"rentM2High":26,"rentLevel":"Moyen","customRent":0,"tenantCharges":80,"pno":150,"coproCharges":1200,"recoverableCharges":700,"propertyTax":900,"teom":150,"managementFees":0,"gli":0,"maintenance":300,"vacancy":500,"otherCharges":0,"simplifiedMode":true,"totalInvestment":251625,"cashflowMonthly":-210.5,"grossYield":4.6,"netYield":3.9}',
  '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z'),
 ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'SIM-2026-0002', 1, true,
  '{"title":"Studio Vincennes","status":"Abandonnée","propertyType":"Appartement","city":"Vincennes","surface":"19,5","agency":"agence du parc","agentName":"Claire M.","agentEmail":"claire.martin@agence.test","offerPrice":150000,"loanYears":15,"rentLevel":"Personnalisé","customRent":690,"dpe":"Z","listingUrl":"ftp://bad"}',
  '2026-09-02T10:00:00Z', '2026-09-02T10:00:00Z'),
 ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'SIM-2026-0001', 1, false,
  '{"title":"Maison Melun","status":"Offre en cours","propertyType":"Maison","city":"Melun","surface":95,"agency":"Agence du Parc","offerPrice":260000,"loanYears":25,"rentLevel":"Haut","rentM2Low":12,"rentM2High":14}',
  '2026-09-03T10:00:00Z', '2026-09-03T10:00:00Z');

insert into public.contacts (id, user_id, data) values
 ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '{"name":"Notaire Dupont","email":"dupont@notaire.test"}');
