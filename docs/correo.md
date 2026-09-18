# Correo de acceso a EnElTop

Estado comprobado el **18 de septiembre de 2026**: Postmark aprobó la cuenta para envíos reales; `eneltop.com` tiene DKIM y Return-Path verificados. El token del servidor está instalado en `ai1` y la solicitud de acceso a un buzón propio en `omegacortex.ai` respondió HTTP 200. El mensaje de `acceso@eneltop.com` llegó a la bandeja de entrada. La cuenta de Resend sigue pendiente de revisión; no hay clave de Resend instalada en producción.

## Flujo de usuario

1. El usuario introduce su dirección en `https://eneltop.com/cuenta/`.
2. `POST /api/auth/request` crea un enlace de un solo uso válido durante 15 minutos y envía el correo `Accede a tu cuenta de EnElTop` desde `EnElTop <acceso@eneltop.com>`.
3. El navegador confirma el enlace mediante `POST /api/auth/verify`; la sesión dura 30 días y se guarda en una cookie `HttpOnly`, `Secure` y `SameSite=Lax`.
4. La cuenta solo muestra proyectos cuyo correo de comprador confirmado por Dodo coincide con el correo autenticado. El dueño puede corregir la URL o el logo y hacer una nueva oferta. Los cambios de posición siguen dependiendo del webhook de pago confirmado.

El servidor limita las solicitudes a tres por dirección en 15 minutos y quince por IP en una hora. Los hashes de enlaces y sesiones se guardan en `/var/lib/eneltop/accounts.json`, fuera del repositorio. El endpoint de solicitud exige origen propio y JSON.

## Postmark en producción

- Cuenta aprobada, fuera de *Test mode*; servidor `My First Server`, ID `21006013`, flujo transaccional `outbound` (mostrado en Postmark como **Default Transactional Stream**).
- Dominio remitente: `eneltop.com`. Dirección predeterminada: `acceso@eneltop.com`.
- La clave requerida es un **Server API Token** de ese servidor, nunca el Account API Token ni un SMTP Token. Archivo privado en `ai1`: `/var/lib/eneltop/postmark-server-token`, propietario `www-data`, modo `0600`. Existe una copia local en `~/Downloads/postmark-server-token`, también privada. No copiar valores de claves al repositorio, tickets, capturas ni chats.
- `server/accounts.js` lee la clave al enviar y llama a `https://api.postmarkapp.com/email` con `MessageStream: "outbound"`. No hace falta reiniciar el servicio después de reemplazar el archivo.
- Nginx dirige `/api/auth/request` al proceso Node de `eneltop-visits.service`; el sitio se sirve desde `/var/www/eneltop.com` y el servidor Node desde `/opt/eneltop`.

### Registros DNS en Hostinger

La zona usa `lunar.dns-parking.com` y `solar.dns-parking.com`. Hostinger añade `.eneltop.com` a los nombres siguientes:

| Tipo | Nombre | Destino o valor |
| --- | --- | --- |
| TXT | `20260918170628pm._domainkey` | Clave pública DKIM generada en **Postmark → Sender Signatures → eneltop.com → DNS Settings** |
| CNAME | `pm-bounces` | `pm.mtasv.net` |

Postmark marcó ambos como **Verified**. El TXT DKIM debe copiarse sin espacios añadidos dentro de la clave; durante la configuración se detectó y corrigió ese error consultando directamente el DNS autoritativo. Postmark no exige un registro SPF adicional para este envío. DMARC todavía figura como inactivo en Postmark; configurarlo y supervisarlo es una tarea pendiente, separada del funcionamiento actual del acceso.

### Verificación y diagnóstico

```bash
dig @solar.dns-parking.com +short TXT 20260918170628pm._domainkey.eneltop.com
dig @solar.dns-parking.com +short CNAME pm-bounces.eneltop.com
ssh ai1 'sudo -n systemctl is-active eneltop-visits.service'
ssh ai1 'sudo -n journalctl -u eneltop-visits.service --since "10 minutes ago" --no-pager'
```

Para probar el flujo, solicitar el enlace en `/cuenta/` usando un buzón propio y comprobar **Postmark → My First Server → Default Transactional Stream → Activity** y la bandeja de entrada. `POST /api/auth/request` debe responder `{"ok":true}`; no abrir el enlace de prueba de otra persona, porque se consume al utilizarlo. No registrar tokens de sesión ni el cuerpo completo del correo en logs.

Antes de la aprobación, Postmark devolvía HTTP 422, código `412`, al intentar enviar desde `eneltop.com` a `omegacortex.ai`: en *Test mode* el destinatario debía compartir el dominio del remitente. La prueba al buzón especial `test@blackhole.postmarkapp.com` respondió HTTP 200. Tras la aprobación, la solicitud real a un buzón propio en `omegacortex.ai` respondió HTTP 200 y el correo llegó. Si aparece HTTP 502 desde EnElTop, revisar el journal y la actividad de Postmark; `server/accounts.js` registra solo el estado del proveedor, no la clave.

### Rotación del token

En **Postmark → Servers → My First Server → API Tokens**, usar **Generate New**. Guardar el nuevo valor en un archivo local privado, por ejemplo `~/Downloads/postmark-server-token`, con modo `0600`. Para instalarlo sin mostrarlo en la consola:

```bash
scp ~/Downloads/postmark-server-token ai1:/tmp/eneltop-postmark-server-token
ssh ai1 'sudo -n install -o www-data -g www-data -m 600 /tmp/eneltop-postmark-server-token /var/lib/eneltop/postmark-server-token && rm /tmp/eneltop-postmark-server-token'
```

Comprobar la autenticación con Postmark y un envío real; después eliminar el token antiguo en esa misma pantalla. El primer token se mostró en una conversación durante la configuración: **verificar que haya sido eliminado**. La clave instalada el 18 de septiembre es una versión posterior y autenticó correctamente; no se ha comprobado desde aquí la revocación del token anterior.

## Resend como alternativa

La cuenta de Resend fue suspendida temporalmente y su revisión adicional continúa pendiente. No asumir que puede entregar correo hasta que Resend confirme su reactivación y se verifique `eneltop.com`. Si se activa, guardar su clave en `/var/lib/eneltop/resend-api-key`, privada para `www-data`.

Con solo la clave de Postmark instalada, Postmark es el proveedor usado. Si existen ambas claves, el código usa Resend por defecto; configurar `ENELTOP_MAIL_PROVIDER=postmark` en el servicio mantiene Postmark como proveedor. `ENELTOP_MAIL_FROM` permite cambiar el remitente, que debe pertenecer a un dominio verificado. Las rutas de archivo se pueden cambiar con `ENELTOP_POSTMARK_KEY_FILE` y `ENELTOP_MAIL_KEY_FILE`. No se hace conmutación automática si el proveedor elegido falla: la solicitud devuelve HTTP 502.

## Referencias

- [Aprobación de cuentas en Postmark](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work)
- [Ubicación y tipos de tokens](https://postmarkapp.com/support/article/1008-what-are-the-account-and-server-api-tokens)
- [Rotación de Server API Tokens](https://postmarkapp.com/support/article/1293-how-to-cycle-a-server-api-token)
