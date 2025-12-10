# GreenAlgeria Backend

API Node.js / Express avec MongoDB, upload d’images et géocodage léger.

## Installation locale
```bash
cd greenalgeria-backend
npm install
cp env.example .env   # puis remplir
npm start
```

## Variables d’environnement (.env)
- `MONGO_URI` : URI MongoDB (obligatoire)
- `BASE_URL` : URL publique du backend (ex: https://api.mondomaine.com)
- `PORT` : port d’écoute (défaut 4000)
- `NOMINATIM_UA` : User-Agent pour Nominatim
- `GEO_ROUND_PRECISION` : décimales pour lat/lng (défaut 4)
- `NOMINATIM_MIN_GAP_MS` : délai minimal entre deux appels Nominatim (ms, défaut 500)
- `GEO_CACHE_PRECISION` : arrondi pour cache géocode (défaut 3)

## Lancement Docker
```bash
cd greenalgeria-backend
docker build -t greenalgeria-backend .
docker run -p 4000:4000 --env-file .env greenalgeria-backend
```

## Endpoints
- `POST /api/contributions` : créer une contribution (validations + rate limit)
- `GET /api/contributions` : lister les contributions
- `POST /api/upload` : upload d’image (3MB max, jpeg/png/webp, rate limit)
- `GET /uploads/*` : accès aux fichiers uploadés
- `GET /static/*` : accès aux fichiers statiques

## Sécurité / limites
- Vars sensibles via `.env` uniquement (pas d’URI en clair)
- Rate limiting sur contributions et upload
- Validation stricte des champs requis (lat/lng)
- Upload limité à 3MB et aux types image autorisés
# greenalgeria-backend