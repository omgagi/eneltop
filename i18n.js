(()=>{
  const stored=localStorage.getItem('eneltop-language');
  const language=stored||(/^es(?:-|$)/i.test(navigator.language||'es')?'es':'en');
  const locale=language==='es'?'es-ES':'en-US';
  window.eneltopI18n={language,locale};
  document.documentElement.lang=language;
  if(language==='es'){
    addSelector();
    return;
  }

  const translations=new Map(Object.entries({
    'eneltop.com — El primer puesto está en juego':'eneltop.com — The top spot is up for grabs',
    'Descubre proyectos y compite por el primer puesto de cada categoría en En el Top.':'Discover projects and compete for the top spot in every EnElTop category.',
    'La opción de pago se encuentra deshabilitada por el momento':'Payments are temporarily unavailable',
    'La opción de pago se encuentra deshabilitada por el momento.':'Payments are temporarily unavailable.',
    'visitas acumuladas':'total visits','visitas acumuladas · eneltop.com':'total visits · eneltop.com',
    'Mi cuenta':'My account','Categorías':'Categories','Acerca de':'About','Reglas':'Rules','Navegación principal':'Main navigation','Buscar proyectos':'Search projects','Cambiar tema':'Change theme','Filtrar por categoría':'Filter by category','Periodo':'Time period',
    'Reducir oferta un centavo':'Decrease bid by one cent','Aumentar oferta un centavo':'Increase bid by one cent','Oferta en dólares; escribe los dígitos y los dos últimos serán céntimos':'Bid in dollars; type digits and the last two will be cents','URL de tu proyecto':'Your project URL','Página anterior':'Previous page','Página siguiente':'Next page','Cerrar':'Close','Nombre, descripción o categoría':'Name, description or category',
    '♕ Todo el tiempo':'♕ All time','Todo el tiempo':'All time','Hoy':'Today','Consigue el Top':'Reach the Top','con':'with',
    'Elige una categoría':'Choose a category','Reclamar puesto':'Claim a spot','Actividad reciente':'Recent activity',
    'Ranking de hoy':'Today’s ranking','Ver todo ›':'View all ›','en números':'by the numbers','Visitas':'Visits',
    'Miembros del ranking':'Ranking members','Volver arriba':'Back to top','Buscar proyectos':'Search projects',
    'Escribe para filtrar el ranking.':'Type to filter the ranking.','Ofertas deshabilitadas temporalmente':'Bids temporarily unavailable',
    'Inténtalo de nuevo más tarde.':'Please try again later.','Presenta tu proyecto':'Submit your project',
    'Verifica tu correo antes de pagar. Con él podrás corregir tu puesto después. El puesto se publicará cuando Dodo confirme el pago.':'Verify your email before paying. You can use it to edit your listing later. Your listing will be published after Dodo confirms the payment.',
    'Tu correo para gestionar el puesto':'Email used to manage your listing','Te enviamos un código de seis dígitos. Revisa tu correo e introdúcelo aquí.':'We sent you a six digit code. Check your email and enter it here.',
    'Código de verificación':'Verification code','Confirmar correo y continuar →':'Verify email and continue →','Enviar otro código':'Send another code',
    'Nombre que aparecerá en el ranking':'Name shown in the ranking','Descripción':'Description','Categoría':'Category','Oferta (USD)':'Bid (USD)','Ej.: tu marca o nombre de perfil':'E.g. your brand or profile name','https://tuproyecto.com':'https://yourproject.com','Una frase sobre lo que haces':'One sentence about what you do','Oferta en dólares; los dos últimos dígitos son céntimos':'Bid in dollars; the last two digits are cents',
    'Foto o logo para el ranking (opcional)':'Photo or logo for the ranking (optional)','Elegir imagen':'Choose image','Ningún archivo seleccionado':'No file selected',
    'JPG, PNG o WebP · mínimo 128 × 128 px · máximo 3 MB · recorte cuadrado. Si no eliges una imagen, intentaremos obtenerla de la URL.':'JPG, PNG or WebP · minimum 128 × 128 px · maximum 3 MB · square crop. If you do not choose an image, we will try to retrieve it from the URL.',
    'Continuar al pago →':'Continue to payment →','Revisa el importe antes de continuar. Dodo procesa el pago de forma segura. Tu puesto quedará vinculado al correo verificado.':'Review the amount before continuing. Dodo processes the payment securely. Your listing will be linked to the verified email.',
    'Todas':'All','Productividad':'Productivity','Agentes':'Agents','Desarrollo':'Development','Otros':'Other',
    'Gestiona tus puestos':'Manage your listings','Recibe un enlace de acceso en el correo que usaste al pagar. Sin contraseña.':'Receive a sign in link at the email address you used to pay. No password needed.',
    'Correo electrónico':'Email address','Enviarme el enlace →':'Send me the link →','← Volver al inicio':'← Back to home','← Volver a mis puestos':'← Back to my listings','tu@correo.com':'you@email.com','Hola, vi tu puesto en EnElTop…':'Hi, I saw your listing on EnElTop…','Secciones de mi cuenta':'My account sections','Escribí mal mi correo al pagar':'I entered the wrong email when paying',
    'MENSAJE PRIVADO':'PRIVATE MESSAGE','Contactar a un miembro':'Contact a member','Cargando puesto…':'Loading listing…',
    'Tu mensaje llegará al inbox del propietario registrado de este puesto. Tu correo no se mostrará.':'Your message will reach the registered owner’s inbox. Your email will not be shown.',
    'Tu mensaje':'Your message','Enviar a este miembro →':'Send to this member →','Mensaje enviado':'Message sent','Ver mis mensajes →':'View my messages →','Volver al ranking':'Back to ranking',
    'MI CUENTA':'MY ACCOUNT','Tu espacio en EnElTop':'Your EnElTop space','Ver el ranking →':'View ranking →','Mis puestos':'My listings','Mensajes':'Messages','Mis contactos':'My contacts','Ayuda':'Help',
    'Gestiona tu perfil y tu posición en el ranking.':'Manage your profile and ranking position.','No encontramos puestos pagados con este correo. Si pagaste con otra dirección, accede con ese correo.':'We could not find paid listings for this email. If you paid with another address, sign in with that email.',
    'Tu correo nunca se muestra a otros miembros.':'Your email is never shown to other members.','Tu bandeja está al día':'Your inbox is up to date','Los mensajes de otros miembros aparecerán aquí.':'Messages from other members will appear here.',
    'Conexiones aceptadas entre miembros.':'Accepted connections between members.','Aún no tienes contactos':'You have no contacts yet','Puedes enviar una solicitud desde cualquier conversación.':'You can send a request from any conversation.',
    '¿Pagaste, pero tu puesto no aparece aquí?':'Paid, but your listing is missing?','Si escribiste mal el correo al pagar, solicita una revisión. Verificaremos el pago con Dodo antes de cambiar el propietario del puesto. No incluyas datos de tarjeta.':'If you entered the wrong email when paying, request a review. We will verify the Dodo payment before changing the listing owner. Do not include card details.',
    'Enlace de tu puesto en EnElTop':'Your EnElTop listing link','Qué ocurrió':'What happened','Solicitar revisión →':'Request review →',
    'Los cambios de URL y logo se reflejan en el ranking. Una oferta nueva se confirma al completar el pago.':'URL and logo changes appear in the ranking. A new bid is confirmed after payment.','Cerrar sesión':'Sign out',
    'Información del puesto':'Listing information','Corrige el enlace o actualiza la imagen que aparece en el ranking.':'Correct the link or update the image shown in the ranking.','Actualizar foto o logo':'Update photo or logo','Guardar cambios':'Save changes','Tu posición':'Your position','Oferta actual:':'Current bid:','Logo actual':'Current logo','Vista previa de tu tarjeta':'Preview of your card','Escribe un mensaje':'Write a message','Enviar mensaje':'Send message','Opciones de conversación':'Conversation options','Conectado':'Online',
    'Cambios guardados.':'Changes saved.','Imagen descargada. Súbela a Instagram para compartirla.':'Image downloaded. Upload it to Instagram to share it.','Enlace copiado.':'Link copied.','No se pudo copiar el enlace.':'Could not copy the link.','Te enviamos un enlace de acceso. Revisa tu correo.':'We sent you a sign in link. Check your email.','Solicitud recibida. Revisaremos el pago antes de cambiar el correo.':'Request received. We will review the payment before changing the email.','Enviando código…':'Sending code…','Abriendo el pago…':'Opening checkout…',
    'Ver puesto →':'View listing →','Aumentar mi oferta (USD)':'Increase my bid (USD)','Aumentar mi oferta →':'Increase my bid →',
    'Se cobra el importe completo de la nueva oferta. Usa el mismo correo en Dodo Payments para actualizar este puesto.':'The full amount of the new bid is charged. Use the same email in Dodo Payments to update this listing.',
    'Copiar enlace':'Copy link','Descargar imagen':'Download image','Estado del pago — eneltop.com':'Payment status — eneltop.com',
    'Comprobando el pago…':'Checking payment…','Tu proyecto se publicará cuando recibamos la confirmación de Dodo Payments.':'Your project will be published when we receive confirmation from Dodo Payments.','Vista previa de tu tarjeta de eneltop.com':'Preview of your eneltop.com card','Pedido no encontrado':'Order not found',
    '¡Comparte tu puesto!':'Share your position!','Comparte tu puesto con tus contactos.':'Share your position with your contacts.','Ver mi puesto en el ranking':'View my listing in the ranking',
    '¿Quieres corregir la URL o el logo más adelante? Entra con el correo que verificaste antes de pagar. No necesitas contraseña.':'Want to correct the URL or logo later? Sign in with the email you verified before paying. No password needed.',
    'Gestionar mi puesto →':'Manage my listing →','Ver factura de Dodo Payments':'View Dodo Payments invoice',
    'Reglas del ranking':'Ranking rules','Descubre sitios y perfiles en el ranking de eneltop.com.':'Discover websites and profiles in the eneltop.com ranking.','· descubre proyectos':'· discover projects',
    'Los dos periodos':'The two time periods','«Todo el tiempo» incluye los proyectos publicados. «Hoy» muestra los que se incorporaron al ranking durante el día UTC actual.':'“All time” includes published projects. “Today” shows projects added to the ranking during the current UTC day.',
    'Cómo se calcula el puesto':'How positions are calculated','Las fichas se ordenan por importe de mayor a menor. La oferta sugerida para ocupar el primer puesto es un centavo superior a la oferta más alta de la vista actual. Al elegir una categoría, el número de puesto se calcula solo entre sus fichas.':'Listings are sorted from the highest to the lowest amount. The suggested bid for first place is one cent above the highest bid in the current view. When you choose a category, the position is calculated only among its listings.',
    'El monto del encabezado se puede escribir o ajustar de centavo en centavo con «−» y «+». Al escribir, cada dígito entra por los céntimos: «1», «12», «123» producen «0,01», «0,12», «1,23». El puesto cambia en ese momento. La oferta mínima es 0,50 USD y no hay importe máximo; un importe ya ocupado o reservado no se acepta para una nueva solicitud.':'You can type the header amount or adjust it one cent at a time with “−” and “+”. While typing, each digit is entered as cents: “1”, “12”, “123” produce “0.01”, “0.12”, “1.23”. The position updates immediately. The minimum bid is USD 0.50 and there is no maximum; an amount already taken or reserved is not accepted for a new submission.',
    'Enlaces y participación':'Links and participation','Al pulsar cualquier parte de una tarjeta se abre la página o el perfil indicado.':'Clicking anywhere on a card opens the listed page or profile.',
    'El formulario abre un checkout de Dodo Payments con el importe elegido. El proyecto aparece públicamente solo después de recibir una confirmación de pago verificada.':'The form opens a Dodo Payments checkout for the selected amount. The project appears publicly only after verified payment confirmation.',
    'Un importe puede quedar reservado mientras se completa el pago. Si el pago no se confirma, el proyecto no se publica. Un reembolso retira el puesto pagado.':'An amount may be reserved while payment is completed. If payment is not confirmed, the project is not published. A refund removes the paid listing.',
    '← Volver al ranking':'← Back to ranking','eneltop.com · Reglas del ranking':'eneltop.com · Ranking rules'
  }));

  const patterns=[
    [/^Consigue el puesto$/,'Reach position'],[/^Visitar (.+)$/,'Visit $1'],[/^ · tu vista local · (.+) · ver detalles$/,' · your local view · $1 · view details'],[/^ · eneltop\.com · (.+) · ver detalles$/,' · eneltop.com · $1 · view details'],
    [/^Escribe a (.+)$/,'Message $1'],[/^Debes ser miembro del ranking para poder contactar a alguien\. Accede con el correo que verificaste al pagar\.$/,'You must be a ranking member to contact someone. Sign in with the email you verified when paying.'],[/^Escribes desde (.+)\. Solo tú verás este correo\.$/,'Writing as $1. Only you will see this email.'],[/^Tu mensaje está en el inbox del propietario de (.+)\. Le enviaremos un aviso por correo\.$/,'Your message is in the inbox of the owner of $1. We will notify them by email.'],
    [/^Contáctame$/,'Contact me'],[/^No hay proyectos en esta vista\. Prueba otra categoría o búsqueda\.$/,'No projects in this view. Try another category or search.'],[/^(\d+) – (\d+) de (\d+)$/,'$1 – $2 of $3'],[/^0 proyectos$/,'0 projects'],
    [/^La oferta mínima es \$0,50\.$/,'The minimum bid is $0.50.'],[/^Con (\$[\d,.]+) quedarías en el #(\d+) de (.+)\. Se publicará al confirmarse el pago\.$/,'With $1 you would rank #$2 in $3. It will be published after payment is confirmed.'],[/^Introduce una oferta de al menos \$0,50\.$/,'Enter a bid of at least $0.50.'],
    [/^#(\d+) en (.+)$/,'#$1 in $2'],[/^#(\d+) en (.+) · #(\d+) general$/,'#$1 in $2 · #$3 overall'],[/^Oferta para llegar al #1 de (.+) \(USD\)$/,'Bid to reach #1 in $1 (USD)'],[/^Llegar al #1 de (.+) →$/,'Reach #1 in $1 →'],[/^Compartir mi puesto #(\d+) en (.+)$/,'Share my #$1 position in $2'],
    [/^Tienes (\d+) mensaje sin leer →$/,'You have $1 unread message →'],[/^Tienes (\d+) mensajes sin leer →$/,'You have $1 unread messages →'],[/^(\d+) nuevo$/,'$1 new'],[/^(\d+) nuevos$/,'$1 new'],
    [/^\((\d+)\) Mi cuenta · EnElTop$/,'($1) My account · EnElTop'],[/^Mi cuenta · EnElTop$/,'My account · EnElTop'],
    [/^Conectado ahora$/,'Online now'],[/^Activo hace un momento$/,'Active moments ago'],[/^Activo hace (\d+) min$/,'Active $1 min ago'],[/^Sobre (.+)$/,'About $1'],[/^Tú · (.+)$/,'You · $1'],[/^Miembro · (.+)$/,'Member · $1'],
    [/^✓ Conectados$/,'✓ Connected'],[/^Solicitud enviada$/,'Request sent'],[/^Aceptar conexión$/,'Accept connection'],[/^\+ Conectar$/,'+ Connect'],[/^Rechazar conversación$/,'Reject conversation'],[/^Bloquear miembro$/,'Block member'],[/^Eliminar contacto$/,'Remove contact'],
    [/^Has bloqueado a este miembro\.$/,'You blocked this member.'],[/^Esta conversación fue rechazada\.$/,'This conversation was rejected.'],[/^Quiere conectar contigo$/,'Wants to connect with you'],[/^Contacto$/,'Contact'],[/^Aceptar$/,'Accept'],[/^Rechazar$/,'Decline'],[/^Mensaje$/,'Message'],
    [/^¡Llegaste al #1!$/,'You reached #1!'],[/^¡Ya estás en el #(\d+)!$/,'You are now #$1!'],[/^¡Pago confirmado!$/,'Payment confirmed!'],[/^Tu proyecto ocupa el #(\d+) de (.+)\.$/,'Your project ranks #$1 in $2.'],[/^Tu proyecto ya aparece en (.+)\.$/,'Your project is now listed in $1.'],
    [/^Pago reembolsado$/,'Payment refunded'],[/^El proyecto ya no ocupa un puesto de pago\.$/,'The project no longer holds a paid position.'],[/^Pago no iniciado$/,'Payment not started'],[/^Vuelve al ranking para intentarlo de nuevo\.$/,'Return to the ranking to try again.'],[/^No se pudo consultar el estado$/,'Could not check status'],[/^Vuelve a intentarlo en unos minutos\.$/,'Please try again in a few minutes.']
  ];

  function translate(value){
    const direct=translations.get(value);if(direct)return direct;
    for(const [pattern,replacement] of patterns)if(pattern.test(value))return value.replace(pattern,replacement);
    return value;
  }
  function translateText(node){
    if(node.parentElement?.closest('.project-title,.project-description,.bubble,.thread-person strong,.contact-card-info strong'))return;
    const original=node.nodeValue,trimmed=original.trim();if(!trimmed)return;
    const translated=translate(trimmed);if(translated!==trimmed)node.nodeValue=original.replace(trimmed,translated);
  }
  function apply(root){
    if(root.nodeType===Node.TEXT_NODE)return translateText(root);
    if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE)return;
    if(root.nodeType===Node.ELEMENT_NODE&&['SCRIPT','STYLE'].includes(root.tagName))return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>['SCRIPT','STYLE'].includes(node.parentElement?.tagName)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
    while(walker.nextNode())translateText(walker.currentNode);
    const elements=root.querySelectorAll?root.querySelectorAll('[placeholder],[aria-label],[title]'):[];
    for(const element of elements)for(const attr of ['placeholder','aria-label','title'])if(element.hasAttribute(attr))element.setAttribute(attr,translate(element.getAttribute(attr)));
    if(root.nodeType===Node.ELEMENT_NODE)for(const attr of ['placeholder','aria-label','title'])if(root.hasAttribute(attr))root.setAttribute(attr,translate(root.getAttribute(attr)));
  }
  apply(document);
  new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')translateText(record.target);for(const node of record.addedNodes)apply(node)}}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  addSelector();

  function addSelector(){
    if(document.getElementById('language-toggle'))return;
    const style=document.createElement('style');style.textContent='.language-toggle{border:1px solid #cbd8e6!important;background:#fff!important;color:#17566d!important;border-radius:999px!important;padding:7px 10px!important;font:800 12px system-ui!important;cursor:pointer!important;margin:0!important;line-height:1!important;white-space:nowrap}.language-toggle:hover{background:#edf4f8!important}';document.head.append(style);
    const button=document.createElement('button');button.id='language-toggle';button.className='language-toggle';button.type='button';button.textContent=language==='es'?'EN':'ES';button.setAttribute('aria-label',language==='es'?'View in English':'Ver en español');button.addEventListener('click',()=>{localStorage.setItem('eneltop-language',language==='es'?'en':'es');location.reload()});
    const nav=document.querySelector('.top-nav');if(nav){const theme=document.getElementById('theme-toggle');nav.insertBefore(button,theme||null)}
    else{const header=document.querySelector('header');if(header)header.append(button);else{button.style.cssText+='position:fixed;top:14px;right:14px;z-index:1000';document.body.append(button)}}
  }
})();
