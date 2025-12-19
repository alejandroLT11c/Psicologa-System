# Dockerfile para el backend de la aplicación de psicóloga
FROM node:18-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY backend/package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar el resto de los archivos del backend
COPY backend/ ./

# Exponer el puerto (Render asignará uno automáticamente)
EXPOSE 4000

# Comando para iniciar el servidor
CMD ["node", "server.js"]

