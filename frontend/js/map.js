/* --------------------------------- */
/* Configuration Globale & Helpers   */
/* --------------------------------- */
const STORAGE_KEY = 'algerie_verte_v3';
let map, markerCluster, heatLayer;
let entries = [];
let tileDefault, tileToner;
let geojsonBounds = null;
let tempMarker = null;
let mapSelectionMode = false; // Mode "sélection sur la carte"
let watchPositionId = null; // ID pour watchPosition (géolocalisation mobile)
const ALGERIA_CENTER = [28.0339, 1.6596];
const APPROX_BOUNDS = L.latLngBounds([18.9681, -8.6675], [37.0937, 11.9795]);
let searchTimeout;

/* Helper: Debounce pour la recherche (UX) */
function debounce(func, delay) {
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => func.apply(context, args), delay);
    };
}
const debouncedSearch = debounce(applyFiltersAndSort, 300);

/* Fonction utilitaire pour haptic feedback */
function hapticFeedback(type = 'light') {
    if (!navigator.vibrate) return;
    
    const patterns = {
        light: 10,
        medium: [10, 20, 10],
        heavy: [20, 30, 20, 30, 20],
        success: [10, 50, 10],
        error: [20, 50, 20, 50, 20]
    };
    
    navigator.vibrate(patterns[type] || patterns.light);
}

/* Helper: toast avancé */
function toast(msg, type='success', timeout=4000){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.setAttribute('role', 'alert');
  t.style.opacity='1';
  t.style.display='flex';
  
  // Haptic feedback selon le type
  if (type === 'success') {
    hapticFeedback('success');
  } else if (type === 'error') {
    hapticFeedback('error');
  } else {
    hapticFeedback('light');
  }

  setTimeout(()=>{
    t.style.opacity='0';
    setTimeout(()=>t.style.display='none', 300);
  }, timeout);
}

/* Helper escape */
function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Récupère l'icône Font Awesome basée sur le type */
function getTreeIconClass(type) {
    type = type.toLowerCase();
    if (type.includes('صنوبر') || type.includes('أرز') || type.includes('conifer')) return 'fas fa-tree';
    if (type.includes('نخيل') || type.includes('palm')) return 'fas fa-leaf';
    if (type.includes('زيتون') || type.includes('olivier')) return 'fas fa-seedling';
    if (type.includes('بلوط') || type.includes('chêne')) return 'fas fa-tree';
    return 'fas fa-seedling';
}

/* Formate la date */
function formatDate(timestamp) {
    if (!timestamp) return 'غير محدد';
    const date = new Date(timestamp);
    const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return date.toLocaleDateString('ar-EG', options);
}

/* --------------------------------- */
/* Gestion de la Carte               */
/* --------------------------------- */

function initMap(){
  map = L.map('map', {center: ALGERIA_CENTER, zoom:5, minZoom:5, maxZoom:12, zoomControl:true});

  tileDefault = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
  tileToner = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png',{maxZoom:20, attribution:'Tiles: Stamen'});

  markerCluster = L.markerClusterGroup({chunkedLoading:true});
  map.addLayer(markerCluster);

  heatLayer = L.heatLayer([], {radius: 25, blur: 18, maxZoom: 11});
  
  // Gérer les clics sur la carte pour définir la position (mode sélection)
  map.on('click', function(e) {
    if (mapSelectionMode) {
      const latlng = e.latlng;
      document.getElementById('latitude').value = latlng.lat.toFixed(6);
      document.getElementById('longitude').value = latlng.lng.toFixed(6);
      setTempMarker(latlng, true);
      validateForm();
      showFormMessage('✅ تم تحديد الموقع على الخريطة! يمكنك سحب العلامة لضبط الموقع.', 'success');
      hapticFeedback('success');
      // Désactiver le mode sélection
      toggleMapSelectionMode(false);
    }
  });

  // Chargement de la frontière GeoJSON de l'Algérie pour les limites
  fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/DZA.geo.json').then(r=>{
    if(!r.ok) throw new Error('GeoJSON load failed');
    return r.json();
  }).then(data=>{
    const algeria = L.geoJSON(data, {style:{color:'#1e88e5', weight:2, fillColor:'rgba(30, 136, 229,0.06)', fillOpacity:1}}).addTo(map);
    geojsonBounds = algeria.getBounds();
    map.fitBounds(geojsonBounds.pad(0.02));
    map.setMaxBounds(geojsonBounds.pad(0.03));
  }).catch(err=>{
    console.warn('GeoJSON failed, using approximate bounds', err);
    map.fitBounds(APPROX_BOUNDS);
    map.setMaxBounds(APPROX_BOUNDS);
  });
    
  document.getElementById('treeForm').addEventListener('input', validateForm);
  document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
  document.getElementById('editForm').addEventListener('input', validateEditForm);

  // Attacher le bouton de géolocalisation (sera aussi fait dans DOMContentLoaded pour sécurité)
  attachGeolocationButton();

  loadFromStorage();
  validateForm();
}

/**
 * Gère le marqueur temporaire (pour Ajout et Édition)
 * @param {L.LatLng} latlng - Coordonnées de la position
 * @param {boolean} draggable - Si le marqueur peut être déplacé
 * @param {number} zoomLevel - Niveau de zoom optionnel (si non fourni, conserve le zoom actuel ou utilise 10 minimum)
 */
function setTempMarker(latlng, draggable, zoomLevel = null) {
    if (tempMarker) map.removeLayer(tempMarker);

    const tempIcon = L.divIcon({
        className: 'temp-marker-icon',
        html: '<i class="fas fa-map-pin"></i>',
        iconSize: [40, 42],
        iconAnchor: [20, 40]
    });

    tempMarker = L.marker(latlng, { icon: tempIcon, draggable: draggable });

    tempMarker.on('dragend', function(e) {
        const newLatlng = tempMarker.getLatLng();
        const isEditing = document.getElementById('editModalOverlay').classList.contains('open');

        const latEl = document.getElementById(isEditing ? 'editLatitude' : 'latitude');
        const lngEl = document.getElementById(isEditing ? 'editLongitude' : 'longitude');

        latEl.value = newLatlng.lat.toFixed(6);
        lngEl.value = newLatlng.lng.toFixed(6);

        if (isEditing) { validateEditForm(); } else { validateForm(); }
        toast('تم تحديث الإحداثيات عبر السحب', 'alert');
    });

    tempMarker.addTo(map);
    
    // Centrer la carte avec animation fluide
    // Si zoomLevel est fourni, l'utiliser, sinon garder le zoom actuel (minimum 10)
    if (zoomLevel !== null) {
        map.setView(latlng, zoomLevel, { animate: true, duration: 0.5 });
    } else {
        const currentZoom = map.getZoom();
        const minZoom = currentZoom < 10 ? 10 : currentZoom;
        map.setView(latlng, minZoom, { animate: true, duration: 0.5 });
    }
    
    // Animation du marqueur pour attirer l'attention
    setTimeout(() => {
        if (tempMarker && tempMarker._icon) {
            tempMarker._icon.style.transition = 'transform 0.3s ease';
            tempMarker._icon.style.transform = 'scale(1.2)';
            setTimeout(() => {
                if (tempMarker && tempMarker._icon) {
                    tempMarker._icon.style.transform = 'scale(1)';
                }
            }, 300);
        }
    }, 100);
}

/**
 * Ajout du marqueur d'arbre sur la carte (avec Popup élégante)
 */
function addEntryToMap(entry){

  const treeIconClass = getTreeIconClass(entry.type);

  const customIcon = L.divIcon({
    className: 'tree-marker-icon',
    html: `<i class="${treeIconClass}"></i>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -36]
  });

  const marker = L.marker([entry.lat, entry.lng], {icon: customIcon});

  // --- CONTENU DE LA POPUP ÉLÉGANTE ---
  const popupContent = `
    <div class="elegant-popup" dir="rtl">
        <h4><i class="${treeIconClass}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}</h4>
        <p>العدد: ${entry.quantite} شجرة</p>
        <button class="popup-btn" onclick="centerAndOpenPanel('${entry.id}')">
            عرض التفاصيل <i class="fas fa-arrow-left" style="margin-right:5px;"></i>
        </button>
    </div>
  `;
  // ---------------------------------------------

  marker.bindPopup(popupContent, {
      closeButton: false, 
      autoClose: true, 
      closeOnClick: true,
      // La taille maximale est ajustée par le CSS min-width: 200px
  });

  // Le clic sur le marqueur Ouvre la popup par défaut. 
  // Sur mobile, on ferme la sidebar pour ne pas masquer la popup.
  marker.on('click', function(){
      const isMobile = window.matchMedia('(max-width: 1024px)').matches;
      if (isMobile) { toggleSidebar(false); }
  });

  marker._entryId = entry.id;
  markerCluster.addLayer(marker);

  return marker;
}

/**
 * Centre la carte sur des coordonnées et ajuste le zoom
 */
function centerOn(lat,lng, zoomLevel=12){
    map.setView([lat,lng], zoomLevel);
}

/**
 * Fonction combinée pour centrer et ouvrir le panneau de détail
 * Utilisé par le bouton dans la popup et les actions de la liste.
 */
function centerAndOpenPanel(id) {
    const entry = entries.find(x => x.id === id);
    if (!entry) return;

    centerOn(entry.lat, entry.lng, 15); 
    showDetailPanel(id);
}

/**
 * Trouve l'entrée et l'affiche dans le panneau de détail
 */
function showDetailPanel(id){
    const entry = entries.find(x => x.id === id);
    if (!entry) { toast('خطأ: لم يتم العثور على المساهمة', 'error'); return; }

    const typeIcon = getTreeIconClass(entry.type);

    // Mise à jour des boutons d'action
    document.getElementById('detailEditBtn').dataset.id = entry.id;
    document.getElementById('detailDeleteBtn').dataset.id = entry.id;

    // Mise à jour du contenu
    document.getElementById('detail-title').innerHTML = `<i class="${typeIcon}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}`;
    document.getElementById('detail-photo').src = entry.photo || 'https://via.placeholder.com/400x200?text=No+Image';
    document.getElementById('detail-photo').onerror = function(){ this.src='https://via.placeholder.com/400x200?text=No+Image'; };

    document.getElementById('detail-type').textContent = `${escapeHtml(entry.type)} ${entry.updatedAt ? '(معدّل)' : ''}`;
    document.getElementById('detail-quantite').textContent = `${entry.quantite} شجرة`;
    document.getElementById('detail-nom').textContent = escapeHtml(entry.nom);
    document.getElementById('detail-adresse').textContent = escapeHtml(entry.adresse || 'غير محدد');
    document.getElementById('detail-city').textContent = escapeHtml(entry.city || 'غير محدد');
    document.getElementById('detail-district').textContent = escapeHtml(entry.district || 'غير محدد');
    document.getElementById('detail-date').textContent = entry.date ? entry.date.replace(/-/g, '/') : 'غير محدد';
    document.getElementById('detail-createdAt').textContent = formatDate(entry.createdAt);
    document.getElementById('detail-coords').textContent = `${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)}`;
    
    // Pour l'action "Télécopie"
    document.getElementById('detail-lat').value = entry.lat;
    document.getElementById('detail-lng').value = entry.lng;

    // Afficher le panneau de détail (et changer l'onglet sur mobile)
    switchPanel('detail-panel');
    toggleSidebar(true, 'detail-panel'); // Ouvre la barre latérale sur le détail si mobile
    
    // Fermer toutes les popups
    map.closePopup();

    // Assurer que le marqueur est visible et ouvrir sa *quickPopup* (optionnel)
    let found = null;
    markerCluster.eachLayer(l => { if(l._entryId === id) found = l; });
    if(found) found.openPopup();
}

/**
 * Fonction combinée pour centrer et ouvrir la popup (utilisée par la liste)
 */
function centerAndOpenPopup(id) {
    const entry = entries.find(x => x.id === id);
    if (!entry) return;
    
    // 1. Centrer la carte
    centerOn(entry.lat, entry.lng, 15); 

    // 2. Trouver le marqueur et ouvrir sa popup
    let markerToOpen = null;
    markerCluster.eachLayer(l => { 
        if(l._entryId === id) {
            markerToOpen = l;
        }
    });

    if(markerToOpen) {
        markerToOpen.openPopup();
    }
    
    // Sur mobile, on ouvre la liste juste pour le contexte
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    if (isMobile) { toggleSidebar(true, 'list-panel'); }
}


/* --------------------------------- */
/* Gestion des Données (CRUD)        */
/* --------------------------------- */

/**
 * Convertit un fichier image en base64 pour sauvegarde permanente
 */
function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    
    // Limiter la taille à 2MB pour éviter les problèmes de localStorage
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      showFormMessage('حجم الصورة كبير جداً. الحد الأقصى 2MB', 'error');
      resolve(null);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      resolve(e.target.result); // Retourne le base64
    };
    reader.onerror = function(error) {
      console.error('Erreur de lecture de l\'image:', error);
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Gestion de l'ajout (Création)
 */
// handleSubmit() est définie plus bas dans le fichier avec l'envoi au serveur

/**
 * Gestion de la modification (Update)
 */
async function handleEditSubmit(e){
    e.preventDefault();
    const id = document.getElementById('editId').value;
    let entry = entries.find(x => x.id === id);

    if(!entry) { toast('خطأ: لم يتم العثور على المساهمة', 'error'); return; }

    const newLat = parseFloat(document.getElementById('editLatitude').value);
    const newLng = parseFloat(document.getElementById('editLongitude').value);
    const newQuantite = parseInt(document.getElementById('editQuantite').value);
    
    // Gérer la photo si un nouveau fichier est sélectionné
    const editPhotoInput = document.getElementById('editPhoto');
    if(editPhotoInput && editPhotoInput.files && editPhotoInput.files[0]) {
        try {
            const photoBase64 = await convertImageToBase64(editPhotoInput.files[0]);
            if(photoBase64) {
                entry.photo = photoBase64;
            }
        } catch(error) {
            console.error('Erreur lors de la conversion de la photo:', error);
        }
    }

    // Mettre à jour les propriétés
    entry.nom = document.getElementById('editNom').value.trim();
    entry.adresse = document.getElementById('editAdresse').value.trim();
    entry.type = document.getElementById('editTypeArbre').value;
    entry.quantite = newQuantite;
    entry.date = document.getElementById('editDatePlanted').value || null;
    entry.lat = newLat;
    entry.lng = newLng;
    entry.updatedAt = Date.now(); // Marque la modification

    // Mise à jour de la carte (retirer l'ancien marqueur, ajouter le nouveau)
    let markerToRemove = null;
    markerCluster.eachLayer(l => { if(l._entryId === id) markerToRemove = l; });
    if(markerToRemove) markerCluster.removeLayer(markerToRemove);

    // Réinjecter le marqueur mis à jour
    addEntryToMap(entry);
    centerOn(entry.lat, entry.lng);

    saveToStorage();
    applyFiltersAndSort();
    closeModal();
    showDetailPanel(id); // Afficher la fiche de détail mise à jour
    toast('✅ تم تحديث المساهمة بنجاح.', 'success');
}


/**
 * Gestion de la suppression (Delete)
 */
function removeEntry(id){
  if(!confirm('هل تريد حذف هذه الإضافة بشكل نهائي؟')) return;
  entries = entries.filter(e=>e.id!==id);
  saveToStorage();
  let toRemove = null;
  markerCluster.eachLayer(l=>{ if(l._entryId===id) toRemove=l; });
  if(toRemove) markerCluster.removeLayer(toRemove);
  applyFiltersAndSort();
  toast('تم حذف المساهمة.', 'error');
  // Revenir à la liste après suppression
  switchPanel('list-panel'); 
}



/* --------------------------------- */
/* Modal d'édition et Formulaires    */
/* --------------------------------- */
function openEditModal(id){
    const entry = entries.find(x => x.id === id);
    if (!entry) { toast('خطأ: لم يتم العثور على العنصر', 'error'); return; }

    // Remplissage de la modale
    document.getElementById('editId').value = entry.id;
    document.getElementById('editNom').value = entry.nom;
    document.getElementById('editAdresse').value = entry.adresse || '';
    document.getElementById('editTypeArbre').value = entry.type || '';
    document.getElementById('editDatePlanted').value = entry.date || '';
    document.getElementById('editLatitude').value = entry.lat.toFixed(6);
    document.getElementById('editLongitude').value = entry.lng.toFixed(6);
    document.getElementById('editQuantite').value = entry.quantite || 1;
    
    // Afficher la photo actuelle si elle existe
    const editPhotoPreview = document.getElementById('editPhotoPreview');
    const editPhotoPreviewImg = document.getElementById('editPhotoPreviewImg');
    if(entry.photo) {
        editPhotoPreviewImg.src = entry.photo;
        editPhotoPreview.style.display = 'block';
    } else {
        editPhotoPreview.style.display = 'none';
    }
    
    // Réinitialiser le champ de fichier
    document.getElementById('editPhoto').value = '';

    // Initialiser le marqueur temporaire sur la carte
    setTempMarker(L.latLng(entry.lat, entry.lng), true);

    // Afficher la modale
    document.getElementById('editModalOverlay').classList.add('open');
    validateEditForm();
    toast('اسحب العلامة على الخريطة لتغيير الموقع.', 'alert');
}

function closeModal() {
    document.getElementById('editModalOverlay').classList.remove('open');
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}
// ... (validateForm, validateEditForm, showFormMessage, resetForm, handleGeolocation restent inchangées)

function validateForm() {
    const nom = document.getElementById('nom').value.trim();
    const type = document.getElementById('type_arbre').value;
    const quantite = parseInt(document.getElementById('quantite').value);
    const lat = document.getElementById('latitude').value;
    const lng = document.getElementById('longitude').value;
    const isQuantiteValid = !isNaN(quantite) && quantite >= 1;
    const isValid = nom && type && isQuantiteValid && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));
    document.querySelector('#treeForm button[type="submit"]').disabled = !isValid;
}

function validateEditForm() {
    const nom = document.getElementById('editNom').value.trim();
    const type = document.getElementById('editTypeArbre').value;
    const quantite = parseInt(document.getElementById('editQuantite').value);
    const lat = document.getElementById('editLatitude').value;
    const lng = document.getElementById('editLongitude').value;
    const isQuantiteValid = !isNaN(quantite) && quantite >= 1;
    const isValid = nom && type && isQuantiteValid && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));
    document.getElementById('saveEditBtn').disabled = !isValid;
}

function showFormMessage(text, type='success'){
  const el = document.getElementById('formMessage');
  if (!el) return;
  
  // Réinitialiser les classes
  el.className = '';
  el.classList.add(type);
  
  // Icône selon le type
  const icon = type === 'success' ? '<i class="fas fa-check-circle"></i>' : 
               type === 'error' ? '<i class="fas fa-exclamation-circle"></i>' : 
               '<i class="fas fa-info-circle"></i>';
  
  el.innerHTML = icon + ' <span>' + text + '</span>';
  el.style.display = 'flex';
  el.style.opacity = '1';
  
  // Scroll vers le message si nécessaire
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
  
  // Masquer après 5 secondes avec fade out
  setTimeout(()=>{
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = '';
      el.style.display = 'none';
      el.className = '';
    }, 300);
  }, 5000);
}

function resetForm(){
  document.getElementById('treeForm').reset();
  document.getElementById('preview').style.display='none';
  document.getElementById('preview').src='';
  document.getElementById('latitude').value='';
  document.getElementById('longitude').value='';
  document.getElementById('photo').value = '';
  document.getElementById('quantite').value = '1';
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  // Arrêter la géolocalisation en cours si active
  if (watchPositionId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  validateForm();
}

/**
 * Active/désactive le mode "sélection sur la carte"
 */
function toggleMapSelectionMode(enable) {
  mapSelectionMode = enable;
  const selectBtn = document.getElementById('selectOnMapBtn');
  const helpText = document.getElementById('locationHelpText');
  
  // Arrêter la géolocalisation en cours si on active le mode sélection manuelle
  if (enable && watchPositionId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  
  if (selectBtn) {
    if (enable) {
      selectBtn.classList.add('active');
      selectBtn.innerHTML = '<i class="fas fa-times"></i> إلغاء الاختيار';
      selectBtn.style.background = 'var(--color-danger)';
      helpText.innerHTML = '<i class="fas fa-hand-pointer"></i> <strong>انقر على الخريطة لتحديد موقع الزرع</strong>';
      // Changer le curseur de la carte
      map.getContainer().style.cursor = 'crosshair';
      toast('انقر على الخريطة لتحديد الموقع', 'alert');
    } else {
      selectBtn.classList.remove('active');
      selectBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> اختر على الخريطة';
      selectBtn.style.background = '';
      helpText.innerHTML = 'استخدم زر "تحديد موقعي" لتحديد موقعك تلقائياً، أو "اختر على الخريطة" ثم انقر على الخريطة لتحديد الموقع.';
      // Restaurer le curseur normal
      map.getContainer().style.cursor = '';
    }
  }
}

/**
 * Attache les event listeners au bouton de géolocalisation
 * Cette fonction peut être appelée plusieurs fois en sécurité
 */
function attachGeolocationButton() {
  // Utiliser plusieurs sélecteurs pour être sûr de trouver le bouton
  const geolocBtn = document.getElementById('geolocationBtn') ||
                    document.querySelector('button[aria-label*="تحديد موقعي"]') ||
                    document.querySelector('button[onclick*="handleGeolocation"]') ||
                    document.querySelector('.form-button-group .btn.primary');
  
  if (!geolocBtn) {
    console.warn('Bouton de géolocalisation non trouvé lors de l\'attachement');
    return;
  }
  
  if (geolocBtn.hasAttribute('data-geoloc-attached')) {
    console.log('Bouton déjà attaché');
    return;
  }
  
  // Marquer comme attaché pour éviter les doubles
  geolocBtn.setAttribute('data-geoloc-attached', 'true');
  
  // Retirer l'onclick si présent
  geolocBtn.removeAttribute('onclick');
  
  // Fonction pour gérer le clic - IMPORTANT: doit être appelée directement depuis un événement utilisateur
  const handleGeolocClick = function(e) {
    console.log('Clic sur le bouton de géolocalisation détecté');
    e.preventDefault();
    e.stopPropagation();
    // Appeler directement dans le contexte de l'événement utilisateur
    handleGeolocation();
  };
  
  // Ajouter plusieurs listeners pour meilleure compatibilité mobile
  // Utiliser 'click' qui fonctionne aussi pour les événements tactiles
  geolocBtn.addEventListener('click', handleGeolocClick, { passive: false, capture: false });
  
  // Ajouter aussi touchstart pour mobile (mais ne pas preventDefault pour permettre le click)
  geolocBtn.addEventListener('touchstart', function(e) {
    console.log('Touchstart détecté sur le bouton');
    // Ne pas preventDefault pour permettre le click de se déclencher aussi
  }, { passive: true });
  
  // S'assurer que le bouton est cliquable
  geolocBtn.style.cursor = 'pointer';
  geolocBtn.style.touchAction = 'manipulation';
  geolocBtn.style.webkitTapHighlightColor = 'transparent';
  geolocBtn.style.userSelect = 'none';
  geolocBtn.style.webkitUserSelect = 'none';
  
  console.log('Bouton de géolocalisation attaché avec succès:', geolocBtn);
  
  // Attacher aussi le bouton "sélection sur carte"
  const selectOnMapBtn = document.getElementById('selectOnMapBtn');
  if (selectOnMapBtn && !selectOnMapBtn.hasAttribute('data-attached')) {
    selectOnMapBtn.setAttribute('data-attached', 'true');
    selectOnMapBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMapSelectionMode(!mapSelectionMode);
    }, { passive: false });
    console.log('Bouton "sélection sur carte" attaché');
  }
}

function handleGeolocation(){
  console.log('handleGeolocation appelé');
  
  // Arrêter tout watchPosition en cours
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  
  // Désactiver le mode sélection sur carte si actif
  if (mapSelectionMode) {
    toggleMapSelectionMode(false);
  }
  
  // Vérifier le support de la géolocalisation
  if(!navigator.geolocation){ 
    const errorMsg = 'المتصفح لا يدعم الموقع. يرجى استخدام زر "اختر على الخريطة" لتحديد الموقع يدوياً.';
    console.error('Geolocation non supporté');
    showFormMessage(errorMsg, 'error'); 
    hapticFeedback('error');
    // Proposer automatiquement le mode sélection sur carte
    setTimeout(() => {
      toggleMapSelectionMode(true);
      showFormMessage('يمكنك الآن النقر على الخريطة لتحديد الموقع', 'alert');
    }, 2000);
    return; 
  }

  // Vérifier si on est en HTTPS ou localhost (requis pour la géolocalisation)
  const isSecure = window.location.protocol === 'https:' || 
                   window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   window.location.hostname === '0.0.0.0';
  
  if (!isSecure) {
    const insecureMsg = '⚠️ يتطلب الموقع HTTPS للعمل على الهاتف. يرجى استخدام HTTPS أو "اختر على الخريطة".';
    console.warn('Géolocalisation nécessite HTTPS (sauf localhost)');
    showFormMessage(insecureMsg, 'error');
    setTimeout(() => {
      toggleMapSelectionMode(true);
      showFormMessage('يمكنك الآن النقر على الخريطة لتحديد الموقع', 'alert');
    }, 3000);
    return;
  }

  // Trouver le bouton de manière plus robuste (plusieurs sélecteurs pour mobile)
  const btn = document.querySelector('button[aria-label*="تحديد موقعي"]') ||
              document.querySelector('button[onclick*="handleGeolocation"]') || 
              document.querySelector('.form-button-group .btn.primary') ||
              document.querySelector('.form-button-group button:first-child');
  
  if (!btn) {
    console.error('Bouton de géolocalisation non trouvé');
    showFormMessage('خطأ في العثور على الزر', 'error');
    return;
  }

  console.log('Bouton trouvé:', btn);

  const originalHtml = btn.innerHTML;
  const originalDisabled = btn.disabled;
  
  // Feedback visuel immédiat
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري البحث...';
  btn.disabled = true;
  hapticFeedback('light');
  
  // Détection mobile améliorée
  const isMobile = window.matchMedia('(max-width: 1024px)').matches || 
                   /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   ('ontouchstart' in window);
  
  console.log('Mobile détecté:', isMobile);
  console.log('User Agent:', navigator.userAgent);
  console.log('Protocol:', window.location.protocol);
  console.log('Hostname:', window.location.hostname);
  
  // Message informatif avec instructions pour mobile
  const helpMsg = isMobile 
    ? 'جاري تحديد موقعك... يرجى السماح بالوصول إلى الموقع في إعدادات المتصفح وتأكد من تفعيل GPS.'
    : 'جاري تحديد موقعك... يرجى السماح بالوصول إلى الموقع.';
  showFormMessage(helpMsg, 'alert');
  
  // Options optimisées pour mobile - ACTIVER GPS avec enableHighAccuracy: true
  const options = {
    enableHighAccuracy: true,  // IMPORTANT: Activer pour utiliser le GPS réel sur mobile
    timeout: isMobile ? 60000 : 25000,  // 60 secondes sur mobile (plus de temps pour GPS), 25 sur desktop
    maximumAge: isMobile ? 0 : 30000  // 0 sur mobile (toujours obtenir une nouvelle position), 30 secondes sur desktop
  };
  
  console.log('Options de géolocalisation:', options);

  // Fonction pour traiter la position avec succès
  const handleSuccess = function(pos){
    console.log('Position obtenue avec succès:', pos.coords);
    console.log('Précision:', pos.coords.accuracy, 'mètres');
    console.log('Source:', pos.coords.altitude !== null ? 'GPS' : 'Réseau');
    
    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    
    // Vérifier que les coordonnées sont valides
    if (isNaN(latlng.lat) || isNaN(latlng.lng)) {
      console.error('Coordonnées invalides:', latlng);
      showFormMessage('خطأ: إحداثيات غير صحيحة', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // Vérifier que les coordonnées sont dans les limites de l'Algérie
    // Utiliser geojsonBounds si disponible, sinon APPROX_BOUNDS
    const checkBounds = geojsonBounds || APPROX_BOUNDS;
    if(checkBounds && !checkBounds.contains([latlng.lat, latlng.lng])) {
      console.warn('Position hors limites:', latlng);
      showFormMessage('موقعك خارج حدود الجزائر. يرجى التأكد من الموقع.', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // Arrêter watchPosition si actif
    if (watchPositionId !== null) {
      navigator.geolocation.clearWatch(watchPositionId);
      watchPositionId = null;
    }

    // Mettre à jour les champs
    document.getElementById('latitude').value = latlng.lat.toFixed(6);
    document.getElementById('longitude').value = latlng.lng.toFixed(6);
    
    // Calculer le niveau de zoom optimal selon la précision GPS
    // Plus la précision est bonne, plus on zoome
    const accuracy = pos.coords.accuracy;
    let zoomLevel;
    if (accuracy < 50) {
      zoomLevel = 17; // Très haute précision (GPS actif)
    } else if (accuracy < 100) {
      zoomLevel = 16; // Haute précision
    } else if (accuracy < 500) {
      zoomLevel = 14; // Précision moyenne
    } else {
      zoomLevel = 12; // Précision faible (réseau)
    }
    
    // Placer le marqueur temporaire ET centrer la carte avec le bon zoom
    // setTempMarker va maintenant gérer le centrage avec animation
    setTempMarker(latlng, true, zoomLevel);
    
    // Feedback de succès avec info sur la précision
    const accuracyMsg = pos.coords.accuracy < 50 
      ? '✅ تم تحديد الموقع بدقة عالية! يمكنك سحب العلامة لضبط الموقع.'
      : '✅ تم تحديد الموقع بنجاح! يمكنك سحب العلامة لضبط الموقع.';
    showFormMessage(accuracyMsg, 'success');
    hapticFeedback('success');
    
    // Restaurer le bouton
    btn.innerHTML = originalHtml;
    btn.disabled = originalDisabled;
    
    // Valider le formulaire
    validateForm();
  };

  // Fonction pour gérer les erreurs
  const handleError = function(err){
    console.error('Erreur de géolocalisation:', err);
    let errMsg = 'فشل في الحصول على الموقع.';
    let showRetry = false;
    
    switch(err.code) {
      case 1: // PERMISSION_DENIED
        errMsg = 'تم رفض الوصول إلى الموقع. يرجى السماح بالوصول في إعدادات المتصفح ثم المحاولة مرة أخرى.';
        console.error('Permission refusée');
        showRetry = true;
        break;
      case 2: // POSITION_UNAVAILABLE
        errMsg = 'الموقع غير متوفر. يرجى تفعيل GPS في إعدادات الهاتف ثم النقر على "تحديد موقعي" مرة أخرى.';
        console.error('Position non disponible (GPS probablement éteint)');
        showRetry = true;
        
        // Sur mobile, on réessaie quand même une fois avec watchPosition au cas où
        if (isMobile) {
          console.log('Tentative avec watchPosition comme fallback...');
          
          // Si c'est la première tentative de fallback, on essaie silencieusement
          if (watchPositionId === null) {
              showFormMessage('جاري تفعيل GPS... (قد يستغرق دقيقة)', 'alert');
              
              // TENTATIVE DE RECUPERATION AVEC OPTIONS PLUS LARGES
              const fallbackOptions = {
                  enableHighAccuracy: true, // On insiste sur le GPS
                  timeout: 60000,
                  maximumAge: 0
              };

              watchPositionId = navigator.geolocation.watchPosition(
                handleSuccess,
                function(watchErr) {
                  console.error('Erreur watchPosition:', watchErr);
                  
                  // Si échec total du GPS, tenter une dernière fois en mode "basse précision" (Wifi/Réseau)
                  if (watchErr.code === 3 || watchErr.code === 2) {
                       console.log('Echec GPS, tentative basse précision...');
                       navigator.geolocation.getCurrentPosition(
                           handleSuccess,
                           function(finalErr) {
                               // Echec final
                               let finalMsg = 'فشل تحديد الموقع بدقة. يرجى تفعيل GPS والمحاولة مرة أخرى.';
                               if (finalErr.code === 1) finalMsg = 'تم رفض الإذن. يرجى تفعيل الموقع للمتصفح.';
                               
                               showFormMessage(finalMsg, 'error');
                               
                               btn.innerHTML = '<i class="fas fa-redo"></i> إعادة المحاولة';
                               btn.onclick = function() { handleGeolocation(); };
                               btn.disabled = false;
                           },
                           { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
                       );
                       return;
                  }

                  showFormMessage('فشل تحديد الموقع. يرجى تفعيل GPS.', 'error');
                  btn.innerHTML = originalHtml;
                  btn.disabled = originalDisabled;
                  
                  if (watchPositionId !== null) {
                    navigator.geolocation.clearWatch(watchPositionId);
                    watchPositionId = null;
                  }
                },
                fallbackOptions
              );
              return; // Ne pas restaurer le bouton maintenant
          }
        }
        break;
      case 3: // TIMEOUT
        errMsg = 'انتهت المهلة. تأكد من تفعيل GPS وحاول مرة أخرى.';
        console.error('Timeout');
        showRetry = true;
        
        // Sur mobile, essayer avec watchPosition comme fallback
        if (isMobile) {
          console.log('Timeout - Tentative avec watchPosition...');
          showFormMessage('تأكد من تفعيل GPS... جاري المحاولة...', 'alert');
          watchPositionId = navigator.geolocation.watchPosition(
            handleSuccess,
            function(watchErr) {
              console.error('Erreur watchPosition après timeout:', watchErr);
              showFormMessage('تعذر تحديد الموقع. يرجى التحقق من GPS والمحاولة مجدداً.', 'error');
              hapticFeedback('error');
              btn.innerHTML = '<i class="fas fa-redo"></i> محاولة مجدداً';
              btn.disabled = false;
              // Réattacher l'événement click standard si besoin, ou laisser le bouton actif
              btn.onclick = function() { handleGeolocation(); };
              
              if (watchPositionId !== null) {
                navigator.geolocation.clearWatch(watchPositionId);
                watchPositionId = null;
              }
            },
            {
              enableHighAccuracy: true,
              timeout: 60000,
              maximumAge: 0
            }
          );
          return; // Ne pas restaurer le bouton maintenant
        }
        break;
      default:
        errMsg = `خطأ غير معروف (${err.code}). يرجى المحاولة مرة أخرى.`;
        console.error('Erreur inconnue:', err);
        showRetry = true;
    }

    showFormMessage(errMsg, 'error');
    hapticFeedback('error');
    
    if (showRetry) {
        // Proposer de réessayer au lieu de restaurer simplement
        btn.innerHTML = '<i class="fas fa-redo"></i> تفعيل GPS والمحاولة';
        btn.disabled = false;
        // On s'assure que le clic relance la géolocalisation
        btn.onclick = function(e) { 
            e.preventDefault();
            handleGeolocation(); 
        };
    } else {
        // Restaurer le bouton original
        btn.innerHTML = originalHtml;
        btn.disabled = originalDisabled;
    }
  };

  // Essayer d'abord avec getCurrentPosition
  navigator.geolocation.getCurrentPosition(
    handleSuccess,
    handleError,
    options
  );
}


/* --------------------------------- */
/* Gestion du Stockage & Statistiques*/
/* --------------------------------- */
function saveToStorage(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }catch(e){ console.error(e); toast('فشل في الحفظ المحلي', 'error'); }
}

function loadFromStorage(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{ entries = JSON.parse(raw); }catch(e){ console.warn('parse error',e); entries = []; }
  } else { entries = []; }
  entries = entries.map(e => ({...e, quantite: parseInt(e.quantite) || 1}));
  markerCluster.clearLayers();
  entries.forEach(e=> addEntryToMap(e));
  applyFiltersAndSort();
}

function updateStats(filteredCount = entries.length){
  const totalTrees = entries.reduce((sum, entry) => sum + (parseInt(entry.quantite) || 0), 0);
  document.getElementById('stat-count').textContent = entries.length;
  document.getElementById('stat-total-trees').textContent = totalTrees.toLocaleString();
  const types = new Set(entries.map(e=>e.type));
  document.getElementById('stat-types').textContent = types.size;
  document.getElementById('lastUpdate').textContent = new Date().toLocaleString('ar-EG', {timeZone: 'Africa/Algiers'});
  document.getElementById('filterInfo').textContent = (filteredCount < entries.length) ? `(${filteredCount} نتيجة من ${entries.length})` : `الكل (${entries.length})`;
  document.getElementById('resultsCount').textContent = filteredCount;
}

/* --------------------------------- */
/* Filtres et Affichage de Liste     */
/* --------------------------------- */

function applyFiltersAndSort(){
    let filtered = [...entries];
    const query = (document.getElementById('quickSearch').value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('typeFilter').value;
    const sortOrder = document.getElementById('sortOrder').value;

    if (query) {
        filtered = filtered.filter(e => (
            e.nom + ' ' + (e.adresse || '') + ' ' + e.type
        ).toLowerCase().includes(query));
    }
    if (typeFilter) {
        filtered = filtered.filter(e => e.type === typeFilter);
    }

    filtered.sort((a, b) => {
        if (sortOrder === 'nom') return a.nom.localeCompare(b.nom);
        if (sortOrder === 'type') return a.type.localeCompare(b.type);
        return b.createdAt - a.createdAt;
    });

    updateList(filtered);
    updateMapMarkers(filtered.map(e => e.id));
    updateStats(filtered.length);
}

/**
 * Met à jour la liste latérale (Le clic ouvre le panneau de détail)
 */
function updateList(filteredEntries){
  const container = document.getElementById('locationsList'); container.innerHTML='';
  const items = filteredEntries.slice(0, 50);

  if(items.length === 0){ container.innerHTML = '<div class="muted text-center p-1" style="text-align:center;">لا توجد نتائج مطابقة</div>'; return; }

  items.forEach(e=>{
    const div = document.createElement('div');
    div.className='location-item';
    div.setAttribute('data-id', e.id);
    div.setAttribute('role', 'listitem');
    div.setAttribute('tabindex', '0');
    
    // Le clic sur l'élément (pas sur les boutons d'action) ouvre la fiche de détail
    div.onclick = (event)=> {
        if (!event.target.closest('.location-actions button')) {
            centerAndOpenPanel(e.id); // Centrer sur la contribution et ouvrir le détail
        }
    };
    div.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            centerAndOpenPanel(e.id); 
        }
    };


    const img = document.createElement('img');
    img.src = e.photo || 'https://via.placeholder.com/400x240?text=No+Image';

    const typeIcon = getTreeIconClass(e.type);

    const meta = document.createElement('div'); meta.className='meta';
    const locationInfo = [e.city, e.district].filter(Boolean).join(' — ') || 'غير متوفر';
    meta.innerHTML = `
      <h4>
        <i class="${typeIcon} type-icon"></i> ${escapeHtml(e.type)} (${e.quantite} شجرة)
      </h4>
      <p>${escapeHtml(e.nom)} — ${escapeHtml(e.adresse||'غير محدد')}</p>
      <small class="muted">الموقع: ${escapeHtml(locationInfo)}</small>
      <small class="muted">أُضيف في: ${formatDate(e.createdAt)}</small>
    `;

    const actions = document.createElement('div'); actions.className='location-actions';
    actions.innerHTML = `
      <button class="btn icon-only primary" title="عرض البطاقة" onclick="centerAndOpenPopup('${e.id}')" aria-label="عرض بطاقة ${escapeHtml(e.type)}">
          <i class="fas fa-map-marker-alt"></i>
      </button>
      <button class="btn icon-only primary" title="عرض التفاصيل" onclick="centerAndOpenPanel('${e.id}')" aria-label="عرض تفاصيل ${escapeHtml(e.type)}">
          <i class="fas fa-eye"></i>
      </button>
      <button class="btn icon-only danger" title="حذف" onclick="removeEntry('${e.id}')" aria-label="حذف ${escapeHtml(e.type)}">
          <i class="fas fa-trash-alt"></i>
      </button>
    `;

    div.appendChild(img);
    div.appendChild(meta);
    div.appendChild(actions);
    container.appendChild(div);
  });
}

function updateMapMarkers(visibleIds) {
    markerCluster.clearLayers();
    entries.forEach(entry => {
        if (visibleIds.includes(entry.id)) {
            addEntryToMap(entry);
        }
    });
}


/* --------------------------------- */
/* Gestion UX/UI Mobile (Bottom Sheet) */
/* --------------------------------- */

function toggleSidebar(visible, initialPanel = 'form-panel') {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;

    // Sur desktop, on change juste le panneau sans toggle la visibilité
    if (!isMobile) {
        if (visible && initialPanel) {
            switchPanel(initialPanel);
        }
        return;
    }

    if (visible) {
        sidebar.classList.add('visible');
        switchPanel(initialPanel);
        // Ne pas bloquer le scroll du body pour permettre l'interaction avec la carte
        // document.body.style.overflow = 'hidden'; // Commenté pour permettre le scroll de la carte
        // Overlay optionnel et transparent pour ne pas bloquer les interactions
        const mapwrap = document.querySelector('.mapwrap');
        if (mapwrap) {
            let overlay = mapwrap.querySelector('.sidebar-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay';
                // Overlay transparent avec pointer-events: none pour ne pas bloquer la carte
                overlay.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.1); z-index: 1400; pointer-events: none; animation: fadeIn 0.3s ease-out;';
                mapwrap.appendChild(overlay);
            }
            overlay.style.display = 'block';
        }
    } else {
        sidebar.classList.remove('visible');
        document.body.style.overflow = '';
        // Retirer overlay
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}

/* Support du swipe pour fermer la sidebar */
let touchStartY = 0;
let touchStartX = 0;
let isSwiping = false;

document.addEventListener('DOMContentLoaded', function() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    
    if (!isMobile || !sidebar) return;

    // Gestion du swipe vers la gauche pour fermer (panneau latéral)
    sidebar.addEventListener('touchstart', function(e) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        isSwiping = false;
    }, { passive: true });

    sidebar.addEventListener('touchmove', function(e) {
        if (!touchStartX) return;
        
        const touchY = e.touches[0].clientY;
        const touchX = e.touches[0].clientX;
        const deltaX = touchStartX - touchX; // Négatif = swipe vers la gauche
        const deltaY = Math.abs(touchY - touchStartY);
        
        // Détecter un swipe vers la gauche (plus de mouvement horizontal que vertical)
        if (deltaX > 10 && deltaX > deltaY) {
            isSwiping = true;
            // Appliquer une transformation visuelle pendant le swipe
            e.preventDefault();
            const translateX = Math.max(-deltaX, -sidebar.offsetWidth);
            sidebar.style.transform = `translateX(${translateX}px)`;
        }
    }, { passive: false });

    sidebar.addEventListener('touchend', function(e) {
        if (!touchStartX) return;
        
        const touchX = e.changedTouches[0].clientX;
        const deltaX = touchStartX - touchX;
        
        // Si swipe vers la gauche de plus de 50px, fermer la sidebar
        if (isSwiping && deltaX > 50) {
            toggleSidebar(false);
        } else {
            // Réinitialiser la transformation
            sidebar.style.transform = '';
        }
        
        touchStartX = 0;
        touchStartY = 0;
        isSwiping = false;
    }, { passive: true });

    // Fermer la sidebar en cliquant sur l'overlay (zone sombre)
    const mapwrap = document.querySelector('.mapwrap');
    if (mapwrap) {
        // Utiliser la délégation d'événements pour l'overlay
        mapwrap.addEventListener('click', function(e) {
            if (e.target.classList.contains('sidebar-overlay')) {
                toggleSidebar(false);
            }
        });
    }
});

function switchPanel(targetId, clickedElement = null) {
    const panels = document.querySelectorAll('.mobile-panel');
    const navItems = document.querySelectorAll('.mobile-nav-item');
    const detailNav = document.getElementById('detailNav');
    const isDetailPanel = targetId === 'detail-panel';

    // Haptic feedback sur mobile
    hapticFeedback('light');

    // 1. Gérer l'affichage du panneau avec animation
    panels.forEach(panel => {
        if (panel.id === targetId) {
            panel.style.display = 'block';
            // Animation d'entrée
            panel.style.opacity = '0';
            panel.style.transform = 'translateX(20px)';
            setTimeout(() => {
                panel.style.transition = 'opacity 0.3s, transform 0.3s';
                panel.style.opacity = '1';
                panel.style.transform = 'translateX(0)';
            }, 10);
        } else {
            panel.style.display = 'none';
            panel.style.opacity = '1';
            panel.style.transform = 'translateX(0)';
        }
    });
    
    // 2. Gérer la navigation mobile
    navItems.forEach(item => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
    });

    if (isDetailPanel) {
        // Le panneau Détail est un onglet "spécial" qui apparaît temporairement
        detailNav.style.display = 'flex';
        detailNav.classList.add('active');
        detailNav.setAttribute('aria-selected', 'true');
    } else {
        // Les onglets normaux
        detailNav.style.display = 'none';
        let currentItem = clickedElement;
        if (!currentItem) {
            currentItem = document.querySelector(`.mobile-nav-item[data-target="${targetId}"]`);
        }
        if (currentItem) {
            currentItem.classList.add('active');
            currentItem.setAttribute('aria-selected', 'true');
        }
    }


    // 3. Assurer la mise à jour des données lors du changement vers l'onglet List/Stats
    if (targetId === 'list-panel' || targetId === 'stats-panel') {
        applyFiltersAndSort();
    }
}

// Preview de l'image
// Prévisualisation de la photo dans le formulaire principal
document.getElementById('photo').addEventListener('change', function(event) {
    const preview = document.getElementById('preview');
    if (event.target.files.length > 0) {
        const file = event.target.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        preview.src = '';
        preview.style.display = 'none';
    }
});

// Prévisualisation de la photo dans le modal d'édition
const editPhotoInput = document.getElementById('editPhoto');
if(editPhotoInput) {
    editPhotoInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        const preview = document.getElementById('editPhotoPreview');
        const previewImg = document.getElementById('editPhotoPreviewImg');
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                previewImg.src = e.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        } else {
            preview.style.display = 'none';
        }
    });
}


/* --------------------------------- */
/* Outils de Carte                   */
/* --------------------------------- */
function fitAllMarkers(){
  const layers = markerCluster.getLayers();
  if(layers.length === 0) { toast('لا توجد مساهمات لعرضها على الخريطة.', 'alert'); return; }
  const bounds = L.latLngBounds(layers.map(m=>m.getLatLng()));
  map.fitBounds(bounds.pad(0.25));
}
function zoomToAlgeria(){
    if(geojsonBounds) map.fitBounds(geojsonBounds.pad(0.02));
    else map.setView(ALGERIA_CENTER,5);
}
let heatOn=false;
function toggleHeatmap(){
  heatOn = !heatOn;
  const toggleBtn = document.getElementById('toggleHeat');
  if(heatOn){
    const pts = entries.map(e=>[e.lat, e.lng, 0.6]);
    heatLayer.setLatLngs(pts);
    heatLayer.addTo(map);
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
    toast('خريطة الحرارة مفعلة');
  } else {
    map.removeLayer(heatLayer);
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
    toast('خريطة الحرارة معطلة');
  }
}
let dark=false;
function toggleStyle(){
  dark = !dark;
  const toggleBtn = document.getElementById('toggleStyle');
  if(dark){
      map.removeLayer(tileDefault);
      tileToner.addTo(map);
      toast('سمة داكنة', 'alert');
      toggleBtn.classList.add('active');
      toggleBtn.setAttribute('aria-pressed', 'true');
  }
  else {
      map.removeLayer(tileToner);
      tileDefault.addTo(map);
      toast('سمة افتراضية');
      toggleBtn.classList.remove('active');
      toggleBtn.setAttribute('aria-pressed', 'false');
  }
}


/* --------------------------------- */
/* Import/Export                     */
/* --------------------------------- */
function exportData(){
  const blob = new Blob([JSON.stringify(entries, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'algerie_verte_export.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('تم تصدير البيانات بنجاح.', 'success');
}
function importData(evt){
  const f = evt.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = e => {
    try{
      const parsed = JSON.parse(e.target.result);
      if(!Array.isArray(parsed)) throw new Error('تنسيق الملف غير صحيح.');

      let importedCount = 0;
      parsed.forEach(p=>{
        if(!p.id) p.id='imp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
        p.quantite = parseInt(p.quantite) || 1; 
        
        if(!entries.find(ex => ex.id === p.id)) {
           entries.unshift(p);
           addEntryToMap(p);
           importedCount++;
        }
      });
      saveToStorage();
      applyFiltersAndSort();
      toast(`✅ تم استيراد ${importedCount} مساهمة.`, 'success');
      document.getElementById('importFile').value = '';
    }catch(err){
        toast('خطأ في ملف الاستيراد: '+err.message, 'error');
        document.getElementById('importFile').value = '';
    }
  };
  r.readAsText(f);
}
function clearAllData(){
  if(!confirm('هل تريد مسح كل البيانات المحفوظة محلياً؟ هذا الإجراء لا يمكن التراجع عنه!')) return;
  entries=[]; saveToStorage(); markerCluster.clearLayers(); applyFiltersAndSort(); toast('تم مسح كل البيانات.', 'error');
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}


/* --------------------------------- */
/* Initialisation                    */
/* --------------------------------- */
document.addEventListener('DOMContentLoaded', function(){
  initMap();

  // Pré-remplir la liste des options de filtre de type
  const typeFilterSelect = document.getElementById('typeFilter');
  const existingTypes = new Set(Array.from(typeFilterSelect.options).map(o => o.value).filter(v => v));

  document.getElementById('type_arbre').querySelectorAll('option').forEach(option => {
      if (option.value && !existingTypes.has(option.value)) {
          const newOption = option.cloneNode(true);
          typeFilterSelect.appendChild(newOption);
          existingTypes.add(option.value);
      }
  });

  // Gérer l'ouverture initiale du sidebar sur desktop (pour l'affichage du formulaire)
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (!isMobile) {
      switchPanel('form-panel'); 
  }

  // Pull-to-refresh pour la liste
  if (isMobile) {
      initPullToRefresh();
  }

  // Gestion du clavier virtuel mobile
  initKeyboardHandling();

  // Gestion de l'orientation
  window.addEventListener('orientationchange', handleOrientationChange);
  handleOrientationChange();
  
  // Attacher le bouton de géolocalisation après l'initialisation complète
  // Attendre un peu pour s'assurer que tous les éléments sont chargés (important pour mobile)
  setTimeout(function() {
    attachGeolocationButton();
  }, 300);

  // Exemple : charger une contribution depuis MongoDB (photo Base64 affichée dans la section dédiée)
  loadRemoteSample();
});

/* Pull-to-refresh functionality */
function initPullToRefresh() {
    const locationsList = document.getElementById('locationsList');
    if (!locationsList) return;

    let pullStartY = 0;
    let pullDistance = 0;
    let isPulling = false;
    let pullRefreshElement = null;

    // Créer l'élément pull-refresh
    pullRefreshElement = document.createElement('div');
    pullRefreshElement.className = 'pull-refresh';
    pullRefreshElement.innerHTML = '<i class="fas fa-sync-alt"></i> <span>جاري التحديث...</span>';
    document.body.appendChild(pullRefreshElement);

    locationsList.addEventListener('touchstart', function(e) {
        if (locationsList.scrollTop === 0) {
            pullStartY = e.touches[0].clientY;
            isPulling = false;
        }
    }, { passive: true });

    locationsList.addEventListener('touchmove', function(e) {
        if (pullStartY === 0) return;
        
        const touchY = e.touches[0].clientY;
        pullDistance = touchY - pullStartY;

        if (locationsList.scrollTop === 0 && pullDistance > 0) {
            isPulling = true;
            const pullAmount = Math.min(pullDistance, 80);
            
            if (pullAmount > 50) {
                pullRefreshElement.classList.add('active');
            } else {
                pullRefreshElement.classList.remove('active');
            }
        }
    }, { passive: true });

    locationsList.addEventListener('touchend', function(e) {
        if (isPulling && pullDistance > 50) {
            pullRefreshElement.classList.add('active');
            // Haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate([10, 20, 10]);
            }
            // Rafraîchir les données
            applyFiltersAndSort();
            setTimeout(() => {
                pullRefreshElement.classList.remove('active');
            }, 1000);
        }
        pullStartY = 0;
        pullDistance = 0;
        isPulling = false;
    }, { passive: true });
}

/* Gestion du clavier virtuel mobile */
function initKeyboardHandling() {
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    if (!isMobile) return;

    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            // Scroll vers l'input pour qu'il soit visible
            setTimeout(() => {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });

        // Gérer la soumission du formulaire avec Enter
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                const form = e.target.closest('form');
                if (form) {
                    e.preventDefault();
                    const submitBtn = form.querySelector('button[type="submit"]');
                    if (submitBtn && !submitBtn.disabled) {
                        submitBtn.click();
                    }
                }
            }
        });
    });
}

/* Gestion du changement d'orientation */
function handleOrientationChange() {
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    if (!isMobile) return;

    // Ajuster la hauteur de la sidebar selon l'orientation
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('visible')) {
        // Forcer un recalcul de la hauteur
        setTimeout(() => {
            const sidebarContent = sidebar.querySelector('.sidebar-content');
            if (sidebarContent) {
                sidebarContent.style.maxHeight = window.innerHeight * 0.8 + 'px';
            }
        }, 100);
    }

    // Ajuster la carte
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
        }, 200);
    }
}

async function handleSubmit(){
    const nom = document.getElementById('nom').value.trim();
    const adresse = document.getElementById('adresse').value.trim();
    const type = document.getElementById('type_arbre').value.trim();
    const quantite = parseInt(document.getElementById('quantite').value, 10);
    const lat = parseFloat(document.getElementById('latitude').value);
    const lng = parseFloat(document.getElementById('longitude').value);
    const datePlanted = document.getElementById('date_planted').value || null;
    const photoInput = document.getElementById('photo');
    const photoFile = photoInput.files[0];

    if(!nom || !type){ 
        showFormMessage('الاسم ونوع الشجرة مطلوبان', 'error'); 
        hapticFeedback('error');
        return; 
    }
    if(isNaN(quantite) || quantite < 1){ 
        showFormMessage('الرجاء تحديد عدد الأشجار (1 على الأقل)', 'error'); 
        hapticFeedback('error');
        return; 
    }
    if(isNaN(lat) || isNaN(lng)){ 
        showFormMessage('المرجو وضع الإحداثيات', 'error'); 
        hapticFeedback('error');
        return; 
    }

    const checkBounds = geojsonBounds || APPROX_BOUNDS;
    if(!checkBounds.contains([lat,lng])){ 
        showFormMessage('الإحداثيات خارج حدود الجزائر', 'error'); 
        hapticFeedback('error');
        return; 
    }

    hapticFeedback('success');

    let photoBase64 = null;
    if(photoFile) {
        try {
            photoBase64 = await convertImageToBase64(photoFile);
        } catch(error) {
            console.error('Erreur lors de la conversion de la photo:', error);
            showFormMessage('خطأ في تحميل الصورة', 'error');
        }
    }

    const id = 'e_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const entry = { id, nom, adresse, type, quantite, lat, lng, date: submissionDate, photo: photoBase64, createdAt:Date.now() };
    entries.unshift(entry);
    addEntryToMap(entry);
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    map.setView([lat, lng], 13);
    saveToStorage();
    applyFiltersAndSort();
    showDetailPanel(id);

    const submissionDate = datePlanted || new Date().toISOString();
    const dataToSend = { nom, adresse, type, quantite, lat, lng, date: submissionDate, photo: photoBase64 };
    console.log("📤 Envoi vers le serveur :", dataToSend);

    try {
        const response = await fetch("https://greenalgeria-backend.onrender.com/api/contributions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dataToSend)
        });

        const result = await response.json().catch(() => ({}));
        if (response.ok && result.success) {
            console.log("✅ Arbre enregistré avec ID :", result.insertedId);
            alert("Arbre ajouté avec succès !");
            showFormMessage('✅ تم إضافة الشجرة بنجاح!', 'success');
            resetForm();
            validateForm();
        } else {
            console.error("❌ Erreur serveur :", result.error || 'Réponse invalide');
            alert("Erreur lors de l\'ajout de l\'arbre !");
            showFormMessage('حدث خطأ عند الاتصال بالخادم', 'error');
        }
    } catch (err) {
        console.error("❌ Erreur fetch :", err);
        alert("Impossible de contacter le serveur !");
        showFormMessage('تعذر الاتصال بالخادم. حاول لاحقاً.', 'error');
    }
}

async function loadRemoteSample(){
    const sampleImg = document.getElementById('remoteSamplePhoto');
    const sampleInfo = document.getElementById('remoteSampleInfo');
    if (!sampleImg || !sampleInfo) return;

    try {
        const response = await fetch('https://greenalgeria-backend.onrender.com/api/contributions?limit=1');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[0];
            if (latest.photo) {
                sampleImg.src = latest.photo;
                sampleImg.style.display = 'block';
            } else {
                sampleImg.style.display = 'none';
            }
            const contributor = latest.nom || 'مشارك مجهول';
            const treeType = latest.type || 'نوع غير محدد';
            const createdAt = latest.createdAt ? new Date(latest.createdAt).toLocaleString('ar-EG') : '';
            const locality = [latest.city, latest.district].filter(Boolean).join(' — ');
            const locationTag = locality ? ` | ${locality}` : '';
            sampleInfo.textContent = `${contributor} — ${treeType}${locationTag}${createdAt ? ` (${createdAt})` : ''}`;
            sampleInfo.style.display = 'block';
        } else {
            sampleImg.style.display = 'none';
            sampleInfo.textContent = 'لا توجد بيانات لعرضها حالياً.';
            sampleInfo.style.display = 'block';
        }
    } catch (error) {
        console.warn('تعذر تحميل مثال الصورة من الخادم:', error);
        sampleImg.style.display = 'none';
        sampleInfo.textContent = 'تعذر تحميل مثال الصورة من الخادم.';
        sampleInfo.style.display = 'block';
    }
}