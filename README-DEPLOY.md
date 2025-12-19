# 🚀 Guía de Despliegue - Aplicación de Psicóloga

Esta guía te ayudará a subir tu aplicación a Render.com para que esté disponible 24/7 y puedas acceder desde cualquier dispositivo móvil.

## 📋 Requisitos Previos

1. **Cuenta en GitHub** (gratuita): https://github.com
2. **Cuenta en Render** (gratuita): https://render.com
3. **Git instalado** en tu computadora (opcional, puedes usar GitHub Desktop)

---

## 📦 Paso 1: Preparar el Repositorio en GitHub

### 1.1 Crear un nuevo repositorio en GitHub

1. Ve a https://github.com/new
2. Nombre del repositorio: `psicologa-app` (o el que prefieras)
3. Marca como **Público** (Render gratis requiere repositorios públicos)
4. **NO** marques "Initialize with README"
5. Click en "Create repository"

### 1.2 Subir tu código a GitHub

**Opción A: Usando GitHub Desktop (más fácil)**
1. Descarga GitHub Desktop: https://desktop.github.com
2. Instala y abre GitHub Desktop
3. File → Add Local Repository → Selecciona la carpeta `Psicologa`
4. En la parte inferior, escribe un mensaje como "Primera versión de la app"
5. Click en "Commit to main"
6. Click en "Publish repository"

**Opción B: Usando Git en la terminal**
```bash
cd "C:\Users\AIO HP\Desktop\Psicologa"
git init
git add .
git commit -m "Primera versión de la app"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/psicologa-app.git
git push -u origin main
```
(Reemplaza `TU-USUARIO` con tu nombre de usuario de GitHub)

---

## 🔧 Paso 2: Desplegar el Backend en Render

### 2.1 Crear el servicio del backend

1. Ve a https://dashboard.render.com
2. Click en "New +" → "Web Service"
3. Conecta tu repositorio de GitHub (autoriza Render si es necesario)
4. Selecciona el repositorio `psicologa-app`
5. Configuración:
   - **Name**: `psicologa-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && node server.js`
   - **Plan**: `Free` (o el que prefieras)
6. Click en "Create Web Service"

### 2.2 Configurar variables de entorno (opcional)

En la sección "Environment" del servicio:
- `NODE_ENV`: `production`
- `PORT`: `4000` (Render lo asignará automáticamente, pero puedes ponerlo por si acaso)

### 2.3 Esperar el despliegue

Render comenzará a construir y desplegar tu backend. Esto puede tomar 5-10 minutos la primera vez.

### 2.4 Obtener la URL del backend

Una vez desplegado, verás una URL como:
```
https://psicologa-backend-xxxx.onrender.com
```

**⚠️ IMPORTANTE**: Copia esta URL, la necesitarás en el siguiente paso.

---

## 🌐 Paso 3: Actualizar la URL del Backend en el Frontend

### 3.1 Editar `app.js`

1. Abre `app.js` en tu editor
2. Busca la línea que dice:
   ```javascript
   : "https://TU-BACKEND-URL.onrender.com/api";
   ```
3. Reemplaza `TU-BACKEND-URL.onrender.com` con la URL real de tu backend (sin el `https://` inicial, solo el dominio)
   ```javascript
   : "https://psicologa-backend-xxxx.onrender.com/api";
   ```

### 3.2 Subir el cambio a GitHub

**Con GitHub Desktop:**
1. Verás el cambio en "Changes"
2. Escribe un mensaje: "Actualizar URL del backend"
3. Click en "Commit to main"
4. Click en "Push origin"

**Con Git:**
```bash
git add app.js
git commit -m "Actualizar URL del backend"
git push
```

---

## 🎨 Paso 4: Desplegar el Frontend en Render

### 4.1 Crear el servicio del frontend

1. En Render, click en "New +" → "Static Site"
2. Conecta el mismo repositorio de GitHub
3. Configuración:
   - **Name**: `psicologa-frontend`
   - **Build Command**: `echo "No build needed"`
   - **Publish Directory**: `.` (punto, significa la raíz)
4. Click en "Create Static Site"

### 4.2 Esperar el despliegue

Render desplegará tu frontend. Esto es más rápido que el backend (2-3 minutos).

### 4.3 Obtener la URL del frontend

Una vez desplegado, verás una URL como:
```
https://psicologa-frontend-xxxx.onrender.com
```

**🎉 Esta es la URL que usarás para generar el código QR.**

---

## 🔄 Paso 5: Configurar Auto-Deploy (Opcional pero Recomendado)

Render está configurado para hacer **auto-deploy** cada vez que hagas un `git push`. Esto significa que:

- Cada vez que actualices el código y lo subas a GitHub, Render automáticamente actualizará la aplicación
- **La URL NO cambia**, así que tu código QR seguirá funcionando
- Solo necesitas esperar 2-5 minutos después de cada `git push`

---

## 📱 Paso 6: Generar el Código QR

### 6.1 Abrir el generador de QR

1. Abre el archivo `generate-qr.html` en tu navegador
2. Ingresa la URL del frontend (la que obtuviste en el Paso 4.3)
3. Click en "Generar Código QR"
4. Click en "Descargar QR como imagen"

### 6.2 Imprimir el QR

- Imprime la imagen descargada
- El QR apuntará a la URL del frontend
- Los usuarios podrán escanearlo y acceder directamente a la aplicación

**⚠️ IMPORTANTE**: Solo genera el QR cuando estés seguro de que la URL del frontend es la definitiva. Si cambias la URL después de imprimir, tendrás que generar uno nuevo.

---

## 🔧 Mantenimiento y Actualizaciones

### Cómo actualizar la aplicación después del despliegue:

1. **Haz tus cambios** en los archivos locales
2. **Sube los cambios a GitHub**:
   - Con GitHub Desktop: Commit → Push
   - Con Git: `git add .` → `git commit -m "Descripción"` → `git push`
3. **Render automáticamente desplegará** los cambios (2-5 minutos)
4. **El QR seguirá funcionando** porque la URL no cambia

### Si necesitas cambiar la URL del backend:

1. Edita `app.js` y actualiza la URL
2. Sube el cambio a GitHub
3. Render actualizará automáticamente

---

## 🐛 Solución de Problemas

### El backend no inicia
- Verifica que `package.json` tenga todas las dependencias
- Revisa los logs en Render (sección "Logs")
- Asegúrate de que el "Start Command" sea correcto: `cd backend && node server.js`

### El frontend no carga
- Verifica que `index.html` esté en la raíz del repositorio
- Asegúrate de que la URL del backend en `app.js` sea correcta

### Error de CORS
- El backend ya tiene `cors` configurado, pero si aparece un error, verifica que la URL del backend en `app.js` sea exactamente la misma que la del servicio en Render

### La base de datos se resetea
- En el plan gratuito de Render, si el servicio se "duerme" (sin uso por 15 minutos), la base de datos puede resetearse
- Para evitar esto, considera:
  - Usar un servicio de base de datos externo (PostgreSQL gratuito en Render)
  - O actualizar a un plan de pago que mantenga el servicio siempre activo

---

## 📞 Soporte

Si tienes problemas durante el despliegue:
1. Revisa los logs en Render (sección "Logs" de cada servicio)
2. Verifica que todos los archivos estén en GitHub
3. Asegúrate de que las URLs estén correctamente configuradas

---

## ✅ Checklist Final

- [ ] Repositorio creado en GitHub
- [ ] Código subido a GitHub
- [ ] Backend desplegado en Render
- [ ] URL del backend actualizada en `app.js`
- [ ] Cambio subido a GitHub
- [ ] Frontend desplegado en Render
- [ ] Código QR generado con la URL del frontend
- [ ] QR impreso y probado

¡Listo! Tu aplicación estará disponible 24/7 y podrás acceder desde cualquier dispositivo. 🎉

