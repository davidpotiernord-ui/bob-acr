# BOB (A.C.R. — Assistant de Conformité et de Réglementation)

## Document Maître d'Architecture, Vente & Gouvernance (v1.0)

---

## 1. Vision, Positionnement & Preuve Légale

### 1.1 La Promesse Produit

BOB (A.C.R.) est le copilote interne de conformité pour les PME et ETI (50 à 500+ salariés). Il s'intègre nativement dans le quotidien des collaborateurs (**Microsoft Teams** et **Extension Navigateur Chrome/Edge**) pour rendre le règlement intérieur, les chartes IT, les procédures RH et les obligations légales immédiatement accessibles, tout en fournissant à la direction un **Dashboard Admin de gouvernance, de preuve et de traçabilité**.

### 1.2 Neutralisation de l'effet « Gadget » (L'argument juridique massue)

En droit du travail (notamment en France selon l'**article R. 1321-1 du Code du travail**, et équivalents UE/CH), **la charge de la preuve de la diffusion et de l'accessibilité du règlement intérieur repose exclusivement sur l'employeur**.

* **Le problème du terrain :** Un PDF dormant sur un intranet (SharePoint, Drive) ou un émargement papier initial obsolète ne prouve pas l'accessibilité réelle et continue en cas de litige prud'homal ou d'audit régulatoire (CNIL, AFA).
* **La solution BOB :** BOB ne se contente pas de répondre aux questions ; il enregistre l'empreinte cryptographique des documents diffusés (**SHA-256**), trace l'accessibilité active par canal, historise l'information de manière horodatée et génère un **Dossier de Preuve** irréprochable.

---

## 2. Offre Commerciale Consolidée & Tarification

### 2.1 Cible Marché Cœur (Entreprises 50+ salariés)

* **Périmètre géographique :** France (~42 000), Allemagne (~85 000), Espagne (~28 000), Suisse (~10 500), Belgique (~6 200), Luxembourg (~1 300).
* **Marché francophone immédiat (FR / BE FR / LU / CH Romande) :** ~47 000 entreprises adressables sans traduction de produit.

### 2.2 Structure de l'Offre : Socle Universel + Modules Métiers

#### A. Le Socle Universel (Obligatoire — Inclus)
* **Règlement Intérieur & Notes de Service :** Ingestion et restitution fluide du règlement, chartes informatiques, télétravail.
* **Bases Réglementaires Générales :** Croisement avec le Code du Travail et l'affichage obligatoire.
* **Traçabilité & Preuve :** Dashboard Admin, logs anonymisés, générateur de Certificat de Preuve horodaté.

#### B. Les 4 Modules Spécialisés (Activables à la carte ou en pack)
1. **Module RGPD & Données :** Durées de conservation, gestes en cas de violation de données, droits des personnes.
2. **Module Cyber & Hygiène Numérique (PSSI / NIS 2) :** Signalement phishing, règles d'usage de l'IA/clés USB, procédures d'urgence.
3. **Module Sapin II (Anti-corruption & Éthique) :** Politiques cadeaux/invitations, accès au dispositif d'alerte éthique interne.
4. **Module LCB-FT (Anti-Blanchiment) :** *(Priorité Finance/Immo/Conseil)* Procédures KYC, vigilance renforcée, alertes Tracfin/référent.

### 2.3 Grille Tarifaire (3 Paliers)

* **ESSENTIEL (250 € HT / mois) :** 50 à 150 salariés | Socle Universel + 1 Module au choix | Dashboards & Preuve.
* **CONFORMITÉ + (450 € HT / mois) :** 150 à 500 salariés | Tout inclus (Socle + 4 Modules) | Multi-référents & Cloisonnement service.
* **GROUPE / SUR-MESURE (Sur devis) :** 500+ salariés | Multi-filiales international, SSO avancé, connecteurs GED dédiés.

---

## 3. Architecture Technique Validée & Sécurité Multi-Tenant

### 3.1 Diagramme des Flux Systèmes (Synthèse Globale)

```
                       ┌────────────────────────────────┐
                       │     SSO Entreprise (IdP)       │
                       │   (Microsoft Entra ID/Google)  │
                       └───────────────┬────────────────┘
                                       │ (Vérification Jeton / Rôles)
                                       ▼
┌──────────────────┐        ┌───────────────────────────┐        ┌──────────────────────────────────────┐
│  Utilisateur     │        │        API Gateway        │        │   Serveur Multi-tenant (Scalingo)    │
│  (Teams/Chrome)  │<──────>│   (Auth + tenant_id)      │<──────>│                                      │
└──────────────────┘        └─────────────┬─────────────┘        │  ┌────────────────────────────────┐  │
                                          │                      │  │       Moteur RAG (PostgreSQL)  │  │
                                          │                      │  │  - BDD Privée Client           │  │
┌──────────────────┐                      │                      │  │  - BDD Mutualisée (Socle)     │  │
│  Admin (DRH/DPO) │<─────────────────────┘                      │  └────────────────┬───────────────┘  │
│  Dashboard Admin │──────┐                                      │                   │                  │
└──────────────────┘      │ (Pipeline Ingestion Documentaire)    │                   ▼                  │
                          ▼                                      │  ┌────────────────────────────────┐  │
              ┌────────────────────────┐                         │  │ Passrelle LLM (Moteur IA)      │  │
              │ Empreinte SHA-256      │                         │  │ (Filtrage & Anonymisation)    │  │
              │ + Chunking + Vector.   │────────────────────────>│  └────────────────────────────────┘  │
              └────────────────────────┘                         └──────────────────────────────────────┘
                                          │
                                          ▼ (Escalade & Questions non couvertes)
              ┌───────────────────────────────────────────────────┐
              │ Radar "Zones de Friction" & Notification Référents│
              │ (Interfaces Métiers: DRH, DPO, RSSI, Juridique)   │
              └───────────────────────────────────────────────────┘
```

### 3.2 Principes Clés de Sécurité (Réassurance RSSI & DPO)

1. **API Gateway Unique (Vigile d'accès) :** Toute requête passe par l'API Gateway. Aucune donnée n'est servie sans validation préalable du jeton **SSO** et injection stricte du `tenant_id`.
2. **Cloisonnement Strict RAG :** Chaque requête SQL/Vectorielle applique le filtre `WHERE tenant_id = :current_tenant`. Complété par une isolation PostgreSQL RLS (*Row Level Security*).
3. **Privacy-by-Design RGPD :** Anonymisation irréversible des requêtes utilisateur stockées pour les statistiques. Les logs n'associent jamais l'identité du salarié à la question posée (indispensable pour l'usage éthique/harcèlement).
4. **Hébergement Souverain UE :** Infrastructure hébergée sur Scalingo (datacenters sécurisés en Europe).

---

## 4. Spécifications du Dashboard Admin (Module Preuve & Pilotage)

1. **Coffre-fort Documentaire & Horodatage SHA-256 :**
   * Génération automatique de l'empreinte cryptographique SHA-256 lors de l'upload.
   * Historique des versions (`v1.0`, `v1.1`...) avec statut (Actif, Archivé, En attente).

2. **Bouton 1-Clic : « Générer le Dossier de Preuve » :**
   * Export d'un certificat PDF d'audit résumant les documents actifs, empreintes SHA-256, canaux de distribution connectés et volumes de consultation attestés sur la période.

3. **Radar des Zones de Friction (Gap Analysis) :**
   * Agrégation automatique des questions dont la recherche RAG renvoie une faible pertinence.
   * Détection des manques documentaires (ex. *"14 questions sur le forfait mobilités durables non couvertes par le RI v1.2"*).

4. **Système d'Escalade vers Référents Métiers :**
   * Redirection automatique ou manuelle vers les contacts désignés (DRH pour sanctions/RH, DPO pour données, RSSI pour cyber, Référent Éthique pour Sapin II).

---

## 5. Modèle de Données PostgreSQL (`pgvector`)

```sql
-- Structure de base PostgreSQL pour BOB Multi-Tenant

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Tenants (Entreprises clientes)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    active_modules JSONB NOT NULL DEFAULT '{"rgpd": false, "cyber": false, "sapin2": false, "lcbft": false}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Documents (Coffre-fort & Horodatage)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL si document légal mutualisé
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- 'REGLEMENT_INTERIEUR', 'RGPD', 'CYBER', 'SAPIN2', 'LCBFT'
    version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    sha256_hash CHAR(64) NOT NULL,
    is_mutualized BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- 'DRAFT', 'ACTIVE', 'ARCHIVED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Chunks Documentaires & Vecteurs
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID, -- NULL si mutualisé
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- Dimension adaptée au modèle d'embedding utilisé
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index vectoriel pour recherche de pertinence ultra-rapide
CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- 4. Logs Anonymisés de Consultation & Zones de Friction
CREATE TABLE query_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category VARCHAR(100),
    unanswered BOOLEAN DEFAULT FALSE, -- Indique si la réponse est absente des docs (Zone de friction)
    cited_document_id UUID REFERENCES documents(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Logs d'Audit Administrateurs (Traçabilité des dépôts et actions)
CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admin_user_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'UPLOAD_DOCUMENT', 'ARCHIVE_DOCUMENT', 'EXPORT_PROOF'
    document_id UUID REFERENCES documents(id),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Plan d'Action & Feuille de Route d'Exécution

### Phase 1 : Système Cœur & Pipeline d'Ingestion (Semaines 1-2)
* [ ] Initialisation du dépôt GitHub et déploiement du squelette Scalingo (Node.js/Python).
* [ ] Script de migration PostgreSQL avec `pgvector` et activation de la sécurité Multi-Tenant.
* [ ] Pipeline d'ingestion documentaire : calcul de l'empreinte SHA-256 + découpage (chunking) + vectorisation.

### Phase 2 : API Gateway, Authentification & SSO (Semaines 3-4)
* [ ] Configuration de l'API Gateway avec validation JWT.
* [ ] Intégration du SSO Microsoft Entra ID (Azure AD) pour Teams et l'Interface Admin.
* [ ] Moteur RAG avec gestion du double tiroir (Documents client + Base juridique mutualisée).

### Phase 3 : Interfaces Utilisateur & Dashboard Admin (Semaines 5-6)
* [ ] Enveloppe applicative Widget Teams + Extension Chrome/Edge.
* [ ] Interface Administrateur (Gestion des versions, coffre-fort SHA-256, radar des zones de friction).
* [ ] Générateur de rapport "Certificat Dossier de Preuve PDF".

### Phase 4 : Lancement & Déploiement Pilotes (Semaines 7-8)
* [ ] Tests de charge et audit de cloisonnement strict entre tenants.
* [ ] Déploiement chez les 3 premiers clients pilotes (Zone Francophone 50+ salariés).
---

## Mises à jour d'architecture (Contraintes terrain)

* **Authentification hybride (SSO optionnel) :** Chaque entreprise choisit son mode (`sso` via Entra ID/Google ou `local_email` via domaine email professionnel + OTP/mot de passe géré par l'API Gateway).
* **Cloisonnement strict à la demande (`use_shared_base`) :** Un client peut désactiver l'accès au socle documentaire commun A.C.R. (`use_shared_base = FALSE`) directement depuis son espace Admin. Le verrou est appliqué nativement au niveau PostgreSQL (RLS).
