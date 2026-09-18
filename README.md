# eneltop.com

Ranking público en español. Después del reinicio del 18 de septiembre de 2026, la portada empieza con Antonio Lozada en el primer puesto por 0,50 USD. El importe de ranking es independiente del registro de pago original, que se conserva. La oferta sugerida para el primer puesto se calcula a partir de la mayor oferta visible y sube un centavo cuando cambia el ranking. La oferta mínima de un proyecto nuevo es 0,50 USD. El control de precio admite centavos y no establece un máximo propio.

## Producción

- Nginx sirve el sitio desde `/var/www/eneltop.com` en `ai1` y envía las rutas API configuradas al proceso Node de `eneltop-visits.service`. `/api/checkout` admite cuerpos de hasta 450 kB para la imagen opcional.
- `/api/visits` incrementa un contador compartido para cada navegador nuevo, identificado mediante una cookie firmada.
- `/api/ranking` entrega las posiciones confirmadas por pago y el estado de disponibilidad de Dodo.
- Tras confirmar el pago, `/checkout/resultado/` ofrece compartir el puesto. `/p/<pedido>` muestra una página pública con metadatos Open Graph y `/api/share/card?id=<pedido>` genera la tarjeta PNG de 1200 × 630. El puesto se calcula de nuevo en cada solicitud y solo se comparte para proyectos pagados y visibles.
- El generador de tarjetas usa Pillow en `/opt/eneltop/vendor`. En una instalación nueva: `python3 -m pip install --target /opt/eneltop/vendor -r server/requirements.txt`.
- `/api/checkout` crea una sesión de Dodo para el importe en centavos indicado por el visitante. El formulario envía el proyecto al servidor; no lo guarda solo en el navegador.
- `/api/dodo/webhook` verifica la firma y publica el proyecto tras confirmar un pago de la sesión y el producto correspondientes. Si Dodo cobra en otra moneda, el ranking conserva la oferta original en USD. Los eventos verificados se registran y se reconcilian periódicamente. Un reembolso retira el proyecto; los pagos fallidos o cancelados liberan la reserva.
- El formulario permite subir una foto o logo JPG, PNG o WebP de hasta 3 MB y al menos 128 × 128 px. El navegador la recorta y convierte a PNG cuadrado de 192 × 192 px. El servidor valida el archivo, lo guarda en `/var/lib/eneltop/avatars` y lo sirve mediante `/api/avatar/<pedido>.png` tras confirmar el pago.
- Sin imagen subida, el servidor intenta extraer una imagen del perfil o sitio; si no puede, guarda el favicon del dominio como respaldo. Reintenta la extracción del perfil cada seis horas. El icono del campo URL también cambia al favicon del dominio mientras se escribe.
- Las fotos de las antiguas cuentas editoriales de Instagram permanecen en el repositorio, aunque esas cuentas ya no figuran en el ranking. `scripts/editorial_social_sources.json` guarda sus fuentes; `scripts/download_editorial_avatars.py` permite actualizarlas.
- Los pedidos se guardan en `/var/lib/eneltop/payments.json`. El secreto del webhook se guarda en `/var/lib/eneltop/dodo-webhook-secret`. Ninguno de estos archivos pertenece al repositorio.
- Los pedidos anteriores se conservan como historial de pagos. `hiddenFromRanking` los excluye del ranking; `rankingCents` cambia solo el importe mostrado y `rankedAt` indica cuándo se incorporó la posición al ranking reiniciado.

El botón de lista de espera se eliminó. Mientras no haya una clave Live Mode válida, el sitio muestra que los pagos están deshabilitados y no abre el formulario de cobro. La clave debe guardarse como archivo privado en `/var/lib/eneltop/dodo-live-api-key`; el identificador del producto se configura con `ENELTOP_DODO_PRODUCT_ID` en la unidad de systemd. Nunca incluir la clave en archivos públicos.

## Verificación

Ejecutar `node --test server/payments.test.js` para comprobar publicación, rechazo de eventos incorrectos, conversión de moneda, recuperación de eventos y reembolsos. Antes de aceptar pagos reales, confirmar que `GET /api/ranking` devuelve `paymentsEnabled: true` y completar un pago de prueba autorizado de extremo a extremo en Live Mode.
