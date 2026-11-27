/* ============================================================================
   NATEIVA — Référentiel géographique du Cameroun (régions → villes → quartiers)
   ----------------------------------------------------------------------------
   10 régions (« provinces »). Villes avec coordonnées quand connues.
   Quartiers : noms usuels ; les coordonnées (lat/lng) sont ajoutées par la
   récolte OpenStreetMap (GitHub Action « Récolte écoles », cible geo) et
   servent au contrôle de périmètre (géolocalisation du quartier).
   Format : { code, name, cities:[{ key, name, lat, lng, quartiers:[{n,lat,lng}] }] }
   ========================================================================== */
window.NATEIVA_GEO = {"generatedAt":"2026-11-27","source":"seed","regions":[
{"code":"AD","name":"Adamaoua","cities":[
 {"key":"NGAOUNDERE","name":"Ngaoundéré","lat":7.3167,"lng":13.5833,"quartiers":[]},
 {"key":"MEIGANGA","name":"Meiganga","lat":6.5167,"lng":14.3,"quartiers":[]},
 {"key":"TIBATI","name":"Tibati","quartiers":[]},
 {"key":"BANYO","name":"Banyo","quartiers":[]},
 {"key":"TIGNERE","name":"Tignère","quartiers":[]}]},
{"code":"CE","name":"Centre","cities":[
 {"key":"YAOUNDE","name":"Yaoundé","lat":3.848,"lng":11.5021,"quartiers":[{"n":"BASTOS"},{"n":"MVAN"},{"n":"NSIMEYONG"},{"n":"BIYEM-ASSI"},{"n":"MENDONG"},{"n":"MELEN"},{"n":"EMANA"},{"n":"EMANA BERLIN"},{"n":"ETOUDI"},{"n":"MIMBOMAN"},{"n":"NKOLBISSON"},{"n":"NKOABANG"},{"n":"ESSOS"},{"n":"MVOG-MBI"},{"n":"MVOG-ADA"},{"n":"NLONGKAK"},{"n":"NGOUSSO"},{"n":"OMNISPORT"},{"n":"MESSASSI"},{"n":"OBOBOGO"},{"n":"EFOULAN"},{"n":"EKOUNOU"},{"n":"ODZA"},{"n":"TSINGA"},{"n":"TSINGA VILLAGE"},{"n":"ELIG-EDZOA"},{"n":"MOKOLO"},{"n":"BRIQUETERIE"},{"n":"MADAGASCAR"},{"n":"MBALLA 2"},{"n":"EKIE"},{"n":"DAMAS"},{"n":"SIMBOCK"},{"n":"ETOUG-EBE"},{"n":"MVOLYE"},{"n":"NKOLNDONGO"},{"n":"KONDENGUI"},{"n":"NKOMO"},{"n":"OLEMBE"},{"n":"NYOM"},{"n":"SANTA BARBARA"},{"n":"JOUVENCE"},{"n":"CARRIERE"},{"n":"TONGOLO"},{"n":"MBANKOLO"},{"n":"NKOLFOULOU"},{"n":"ELEVEUR"},{"n":"SIMEYONG"}]},
 {"key":"MBALMAYO","name":"Mbalmayo","lat":3.5167,"lng":11.5,"quartiers":[]},
 {"key":"BAFIA","name":"Bafia","lat":4.75,"lng":11.2333,"quartiers":[]},
 {"key":"OBALA","name":"Obala","quartiers":[]},
 {"key":"MFOU","name":"Mfou","quartiers":[]},
 {"key":"ESEKA","name":"Eséka","quartiers":[]},
 {"key":"NANGA-EBOKO","name":"Nanga-Eboko","quartiers":[]},
 {"key":"AKONOLINGA","name":"Akonolinga","quartiers":[]},
 {"key":"MONATELE","name":"Monatélé","quartiers":[]},
 {"key":"NTUI","name":"Ntui","quartiers":[]}]},
{"code":"ES","name":"Est","cities":[
 {"key":"BERTOUA","name":"Bertoua","lat":4.5776,"lng":13.6846,"quartiers":[]},
 {"key":"BATOURI","name":"Batouri","quartiers":[]},
 {"key":"ABONG-MBANG","name":"Abong-Mbang","quartiers":[]},
 {"key":"YOKADOUMA","name":"Yokadouma","quartiers":[]}]},
{"code":"EN","name":"Extrême-Nord","cities":[
 {"key":"MAROUA","name":"Maroua","lat":10.5956,"lng":14.3247,"quartiers":[]},
 {"key":"YAGOUA","name":"Yagoua","lat":10.3428,"lng":15.2406,"quartiers":[]},
 {"key":"KOUSSERI","name":"Kousséri","quartiers":[]},
 {"key":"MOKOLO","name":"Mokolo","quartiers":[]},
 {"key":"MORA","name":"Mora","quartiers":[]},
 {"key":"KAELE","name":"Kaélé","quartiers":[]}]},
{"code":"LT","name":"Littoral","cities":[
 {"key":"DOUALA","name":"Douala","lat":4.0511,"lng":9.7679,"quartiers":[{"n":"AKWA"},{"n":"AKWA NORD"},{"n":"BONANJO"},{"n":"BONAPRISO"},{"n":"DEIDO"},{"n":"BALI"},{"n":"BONAMOUSSADI"},{"n":"MAKEPE"},{"n":"KOTTO"},{"n":"LOGBABA"},{"n":"NDOKOTTI"},{"n":"BEPANDA"},{"n":"NEW BELL"},{"n":"BONABERIE"},{"n":"NYALLA"},{"n":"JAPOMA"},{"n":"NDOGBONG"},{"n":"LOGPOM"},{"n":"CITE DES PALMIERS"},{"n":"PK8"},{"n":"PK9"},{"n":"PK10"},{"n":"PK12"},{"n":"PK14"},{"n":"YASSA"},{"n":"MBOPPI"},{"n":"NGODI"},{"n":"BONADIBONG"},{"n":"YOUPWE"},{"n":"NDOGPASSI"},{"n":"MAMBANDA"},{"n":"SODIKO"},{"n":"BOJONGO"},{"n":"GRAND HANGAR"},{"n":"ANGE RAPHAEL"},{"n":"CITE SIC"},{"n":"BEEDI"},{"n":"DENVER"},{"n":"NKONGMONDO"},{"n":"NKOLOLOUN"},{"n":"CIC CACAO"},{"n":"MAKAPE"},{"n":"VILLAGE"},{"n":"BASSA"}]},
 {"key":"EDEA","name":"Edéa","lat":3.8,"lng":10.1333,"quartiers":[]},
 {"key":"NKONGSAMBA","name":"Nkongsamba","lat":4.9547,"lng":9.9404,"quartiers":[]},
 {"key":"LOUM","name":"Loum","lat":4.7182,"lng":9.7351,"quartiers":[]},
 {"key":"MBANGA","name":"Mbanga","quartiers":[]},
 {"key":"MANJO","name":"Manjo","quartiers":[]},
 {"key":"YABASSI","name":"Yabassi","quartiers":[]}]},
{"code":"NO","name":"Nord","cities":[
 {"key":"GAROUA","name":"Garoua","lat":9.3265,"lng":13.3958,"quartiers":[]},
 {"key":"GUIDER","name":"Guider","quartiers":[]},
 {"key":"POLI","name":"Poli","quartiers":[]},
 {"key":"TCHOLLIRE","name":"Tcholliré","quartiers":[]}]},
{"code":"NW","name":"Nord-Ouest","cities":[
 {"key":"BAMENDA","name":"Bamenda","lat":5.9631,"lng":10.1591,"quartiers":[]},
 {"key":"KUMBO","name":"Kumbo","lat":6.2,"lng":10.6667,"quartiers":[]},
 {"key":"WUM","name":"Wum","quartiers":[]},
 {"key":"NDOP","name":"Ndop","quartiers":[]},
 {"key":"NKAMBE","name":"Nkambé","quartiers":[]},
 {"key":"MBENGWI","name":"Mbengwi","quartiers":[]}]},
{"code":"OU","name":"Ouest","cities":[
 {"key":"BAFOUSSAM","name":"Bafoussam","lat":5.4781,"lng":10.4179,"quartiers":[]},
 {"key":"DSCHANG","name":"Dschang","lat":5.4437,"lng":10.0533,"quartiers":[]},
 {"key":"FOUMBAN","name":"Foumban","lat":5.7287,"lng":10.8984,"quartiers":[]},
 {"key":"MBOUDA","name":"Mbouda","lat":5.6264,"lng":10.2542,"quartiers":[]},
 {"key":"BANGANGTE","name":"Bangangté","quartiers":[]},
 {"key":"BAFANG","name":"Bafang","quartiers":[]},
 {"key":"BANDJOUN","name":"Bandjoun","quartiers":[]}]},
{"code":"SU","name":"Sud","cities":[
 {"key":"EBOLOWA","name":"Ebolowa","lat":2.9,"lng":11.15,"quartiers":[]},
 {"key":"KRIBI","name":"Kribi","lat":2.9404,"lng":9.9098,"quartiers":[]},
 {"key":"SANGMELIMA","name":"Sangmélima","lat":2.9333,"lng":11.9833,"quartiers":[]},
 {"key":"AMBAM","name":"Ambam","quartiers":[]}]},
{"code":"SW","name":"Sud-Ouest","cities":[
 {"key":"BUEA","name":"Buea","lat":4.1527,"lng":9.292,"quartiers":[]},
 {"key":"LIMBE","name":"Limbé","lat":4.0215,"lng":9.2125,"quartiers":[]},
 {"key":"KUMBA","name":"Kumba","lat":4.6363,"lng":9.4469,"quartiers":[]},
 {"key":"TIKO","name":"Tiko","quartiers":[]},
 {"key":"MAMFE","name":"Mamfé","quartiers":[]},
 {"key":"MUNDEMBA","name":"Mundemba","quartiers":[]}]}
]};
