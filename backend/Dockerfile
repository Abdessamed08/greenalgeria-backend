# Étape 1 : Utiliser une image Nginx légère
FROM nginx:alpine

# Étape 2 : Copier le contenu du site dans le dossier de Nginx
COPY . /usr/share/nginx/html

# Étape 3 : Exposer le port 80
EXPOSE 80

# Étape 4 : Lancer Nginx
CMD ["nginx", "-g", "daemon off;"]
