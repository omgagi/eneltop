# Mensajes internos

- Los puestos pagados con un correo de propietario muestran **Contáctame** dentro de su ficha del ranking.
- Para escribir o responder se necesita una sesión de correo verificado y al menos un puesto pagado vigente. La sesión se crea al verificar el correo antes del pago o al abrir el enlace de acceso de Mi cuenta.
- Los mensajes se guardan en `/var/lib/eneltop/inbox.json` (fuera del repositorio, permiso `0600`). Solo los dos participantes pueden leer y responder a su conversación en `/cuenta/#inbox`. La API nunca devuelve sus direcciones de correo a la otra persona.
- No hay límite de cantidad de mensajes o conversaciones. Cada mensaje admite hasta 2000 caracteres.
- Cada mensaje crea un aviso pendiente. Postmark envía al destinatario un correo con enlace a su inbox, sin incluir el contenido del mensaje. Si falla el envío, el aviso sigue pendiente y el proceso vuelve a intentarlo cada minuto.
- Los perfiles sin correo de propietario guardado no muestran **Contáctame**. Para añadirlo hay que acreditar y asociar la propiedad del puesto; no se inventan direcciones de correo.
