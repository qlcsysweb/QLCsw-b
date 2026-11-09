# Arquitectura de almacenamiento — QLC

## Regla definitiva

```
Imágenes (JPG/JPEG/PNG/WEBP/GIF)  → Cloudinary
Documentos (PDF, contratos, comprobantes, etc.) → Google Drive CORPORATIVO de QLC
Metadata, relaciones y estados     → NeonDB (PostgreSQL)
```

Ningún cliente de QLC conecta su propio Google Drive. El único Drive que la
plataforma usa es el de QLC. El flujo siempre es:

```
Cliente → Portal QLC → Backend QLC → Google Drive de QLC
                                    → NeonDB (metadata + Drive File ID)
```

## Qué va a Cloudinary

Solo imágenes: logo, branding, recursos visuales de la web pública y el QR de
pago. Carpetas usadas: `qlc/public`, `qlc/branding`, `qlc/payments-qr`.
Servicio: `backend/src/services/imageStorage.js`.

## Qué va a Google Drive

Contratos (original y firmado), documentos de clientes, comprobantes de pago.
Servicio: `backend/src/services/documentStorage.js`. Estructura dentro de la
carpeta raíz de QLC:

```
<Carpeta raíz de QLC>/
├── Clientes/
│   └── <Nombre Apellido (clientId)>/
│       ├── Contratos/
│       ├── Documentos/
│       └── Pagos/
├── Administrativos/   (reservado — sin uso automático todavía)
└── Informativos/      (reservado — sin uso automático todavía)
```

Las carpetas se crean automáticamente la primera vez que un cliente sube un
archivo. Los IDs de esas carpetas se cachean en `ClientProfile` para no
repetir búsquedas en Drive en cada subida.

## Qué queda en NeonDB

Nunca el archivo binario. Solo metadata: `driveFileId`, carpeta, nombre
original, MIME type, tamaño, categoría, cliente, fecha, estado y descripción
(modelos `Document`, `Contract`, `PaymentReport`).

## Dónde se configura Google Drive

**Admin → Configuración · Google Drive** (`/admin/settings/drive` en el
frontend, `GET/PUT /api/admin/drive-config` en el backend).

Desde ahí el administrador puede, sin tocar ningún archivo:

- ver el estado de conexión (conectado / desconectado / no configurado);
- cambiar el **nombre** y el **Folder ID** de la carpeta raíz;
- probar la conexión (verifica permisos reales contra Drive: crear, subir,
  descargar, eliminar — sin crear archivos de prueba, usando
  `files.get` con `capabilities`);
- desconectar la integración (deshabilita las subidas sin borrar la
  configuración, para poder reactivarla después).

Estos datos (carpeta, nombre, habilitado/deshabilitado, resultado de la
última prueba) se guardan en la tabla `drive_configuration` de NeonDB — **no
son secretos**, por eso es seguro administrarlos desde la interfaz.

## Qué NO se puede configurar desde la interfaz (y por qué)

La **credencial técnica** de la cuenta de servicio de Google
(`GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) es un
secreto real. Se define únicamente como variable de entorno del backend
(bootstrap de infraestructura) y:

- nunca se guarda en NeonDB;
- nunca se envía al frontend;
- nunca aparece completa en ninguna respuesta de la API (el panel solo
  muestra el email parcialmente enmascarado, y únicamente si ya existe).

Esta es una decisión de seguridad deliberada, no una limitación temporal:
separar "quién puede operar la cuenta de servicio" (infraestructura) de
"qué carpeta usa la plataforma" (negocio/administración).

## Variables de entorno del backend

Obligatorias para que Drive funcione (bootstrap, no editables desde UI):

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

Opcional — solo se usa como valor de arranque la primera vez que se instala
el sistema, si el administrador nunca guardó una carpeta desde el panel:

```
GOOGLE_DRIVE_FOLDER_ID=
```

En cuanto el administrador guarda una carpeta desde
Configuración → Google Drive, esa fila en `drive_configuration` manda sobre
la variable de entorno.

## Pasos para activar Google Drive por primera vez (infraestructura)

1. Crear un proyecto en Google Cloud Console y habilitar "Google Drive API".
2. Crear una cuenta de servicio y generar su clave JSON.
3. Copiar `client_email` y `private_key` del JSON a las variables de entorno
   del backend.
4. Crear la carpeta raíz de QLC en Google Drive y compartirla (rol Editor)
   con el email de la cuenta de servicio.
5. Copiar el Folder ID de esa carpeta (de la URL de Drive) y pegarlo en
   Admin → Configuración → Google Drive → Guardar.
6. Pulsar "Probar conexión" para confirmar permisos.

Mientras estos pasos no se completen, la plataforma nunca simula una subida
exitosa: cualquier intento de subir un documento responde con un error
controlado y humano ("No pudimos conectar con Google Drive...").
