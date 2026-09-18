# eneltop.com

Ranking público en español. La portada muestra una selección editorial de 72 proyectos: 47 cuentas de Instagram y 25 webs latinoamericanas. Los importes editoriales se ordenan de 4,43 USD a 1,00 USD, sin empates. La oferta sugerida para el primer puesto se calcula a partir de la mayor oferta visible y sube un centavo cuando cambia el ranking. La oferta mínima de un proyecto nuevo es 0,50 USD. El control de precio admite centavos y no establece un máximo propio.

## Producción

- Nginx sirve el sitio desde `/var/www/eneltop.com` en `ai1` y envía las rutas API configuradas al proceso Node de `eneltop-visits.service`. `/api/checkout` admite cuerpos de hasta 450 kB para la imagen opcional.
- `/api/visits` incrementa un contador compartido para cada navegador nuevo, identificado mediante una cookie firmada.
- `/api/ranking` entrega las posiciones confirmadas por pago y el estado de disponibilidad de Dodo.
- `/api/checkout` crea una sesión de Dodo para el importe en centavos indicado por el visitante. El formulario envía el proyecto al servidor; no lo guarda solo en el navegador.
- `/api/dodo/webhook` verifica la firma y publica el proyecto tras confirmar un pago de la sesión y el producto correspondientes. Si Dodo cobra en otra moneda, el ranking conserva la oferta original en USD. Los eventos verificados se registran y se reconcilian periódicamente. Un reembolso retira el proyecto; los pagos fallidos o cancelados liberan la reserva.
- El formulario permite subir una foto o logo JPG, PNG o WebP de hasta 3 MB y al menos 128 × 128 px. El navegador la recorta y convierte a PNG cuadrado de 192 × 192 px. El servidor valida el archivo, lo guarda en `/var/lib/eneltop/avatars` y lo sirve mediante `/api/avatar/<pedido>.png` tras confirmar el pago.
- Sin imagen subida, el servidor intenta extraer una imagen del perfil o sitio; si no puede, guarda el favicon del dominio como respaldo. Reintenta la extracción del perfil cada seis horas. El icono del campo URL también cambia al favicon del dominio mientras se escribe.
- Las cuentas editoriales de Instagram usan fotos cuadradas locales. `scripts/editorial_social_sources.json` guarda la URL pública de origen de cada imagen; `scripts/download_editorial_avatars.py` permite actualizarlas.
- Los pedidos se guardan en `/var/lib/eneltop/payments.json`. El secreto del webhook se guarda en `/var/lib/eneltop/dodo-webhook-secret`. Ninguno de estos archivos pertenece al repositorio.

El botón de lista de espera se eliminó. Mientras no haya una clave Live Mode válida, el sitio muestra que los pagos están deshabilitados y no abre el formulario de cobro. La clave debe guardarse como archivo privado en `/var/lib/eneltop/dodo-live-api-key`; el identificador del producto se configura con `ENELTOP_DODO_PRODUCT_ID` en la unidad de systemd. Nunca incluir la clave en archivos públicos.

## Verificación

Ejecutar `node --test server/payments.test.js` para comprobar publicación, rechazo de eventos incorrectos, conversión de moneda, recuperación de eventos y reembolsos. Antes de aceptar pagos reales, confirmar que `GET /api/ranking` devuelve `paymentsEnabled: true` y completar un pago de prueba autorizado de extremo a extremo en Live Mode.
