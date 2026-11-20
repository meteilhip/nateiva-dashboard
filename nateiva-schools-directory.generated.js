/* ============================================================================
   NATEIVA — Répertoire préchargé d'écoles (annuaire)
   ----------------------------------------------------------------------------
   Écoles préchargées pour TOUS les appareils, sans connexion Internet requise.
   Sources possibles : exports OpenStreetMap, annuaires officiels (MINEDUB =
   Ministère de l'Éducation de Base, MINESEC = Ministère des Enseignements
   Secondaires, MINESUP = Ministère de l'Enseignement Supérieur, ANIPES),
   listes relevées sur Facebook / Google Maps par l'équipe.
   MISE À JOUR : envoyer la nouvelle liste à Claude (CSV ou JSON, ou l'export
   « 💾 Exporter le répertoire » de la carte) — elle est fusionnée ici puis
   déployée pour tout le monde.
   Format d'une entrée :
   { city:"DOUALA", name:"…", lat:4.05, lng:9.70, kind:"Primaire / École",
     quartier:"", phone:"", capacity:"", operator:"", source:"OSM|MINEDUB|…" }
   ========================================================================== */
window.NATEIVA_DIRECTORY = [];
