/* Private Drive covers. Called only under the catalog's signed/session lock.
 * Browsers never choose Drive IDs or get public sharing URLs. */
function coverPhotosEnabled_() { if (PropertiesService.getScriptProperties().getProperty('COVER_PHOTOS_ENABLED') !== 'true') failure_('COVER_PHOTOS_UNAVAILABLE'); }
function coverFolder_(c) {
  if (c.environment !== 'dev') failure_('FORBIDDEN');
  storage_(c,false);
  var id = PropertiesService.getScriptProperties().getProperty('COVERS_FOLDER_ID');
  if (!id) failure_('COVER_PHOTOS_UNAVAILABLE');
  var folder = DriveApp.getFolderById(id); assertMarker_(folder,c,'covers'); return folder;
}
function coverBytesHash_(bytes) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)); }
function coverDescriptor_(photo) {
  authControlExact_(photo,['bytes','sha256']);
  if (typeof photo.bytes !== 'string' || photo.bytes.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.bytes) || !accessHash_(photo.sha256)) failure_('COVER_PHOTO_INVALID');
  var bytes = Utilities.base64Decode(photo.bytes);
  if (bytes.length < 4 || bytes.length > 49152 || (bytes[0]+256)%256 !== 255 || (bytes[1]+256)%256 !== 216 ||
      (bytes[bytes.length-2]+256)%256 !== 255 || (bytes[bytes.length-1]+256)%256 !== 217 || Utilities.base64Encode(bytes) !== photo.bytes || coverBytesHash_(bytes) !== photo.sha256) failure_('COVER_PHOTO_INVALID');
  return bytes;
}
function coverFile_(c, id, productId, expectedHash, allowUnmarked, folder) {
  folder = folder || coverFolder_(c);
  var file = DriveApp.getFileById(id), parents = file.getParents(), belongs = false;
  while (parents.hasNext()) if (parents.next().getId() === folder.getId()) belongs = true;
  if (!belongs || file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getMimeType() !== 'image/jpeg' || file.getSize() > 49152 || file.getSize() < 4) failure_('BINDING_MISMATCH');
  var bytes = file.getBlob().getBytes(), hash = coverBytesHash_(bytes), marker;
  try { marker = JSON.parse(file.getDescription()); } catch (_) { marker = null; }
  if (!marker && !allowUnmarked) failure_('BINDING_MISMATCH');
  if (marker) {
    assertMarker_(file,c,'cover');
    if (marker.productId !== productId || !identityUuid_(marker.commandId) || !constantEqual_(hash,marker.sha256)) failure_('BINDING_MISMATCH');
  }
  if (expectedHash && !constantEqual_(hash,expectedHash)) failure_('CATALOG_CONFLICT');
  coverDescriptor_({bytes:Utilities.base64Encode(bytes),sha256:hash});
  return {file:file,bytes:Utilities.base64Encode(bytes),sha256:hash,marker:marker};
}
function ensureCoverPhoto_(c, productId, commandId, photo) {
  coverPhotosEnabled_(); var bytes = coverDescriptor_(photo), folder = coverFolder_(c);
  var name = 'cover-' + productId + '-' + commandId + '.jpg', matches = folder.getFilesByName(name), files = [];
  while (matches.hasNext()) { files.push(matches.next()); if (files.length > 1) failure_('COVER_PHOTOS_UNAVAILABLE'); }
  var file = files.length ? files[0] : folder.createFile(Utilities.newBlob(bytes,'image/jpeg',name));
  // Deterministic name + hash permit resuming after file creation but before
  // acknowledgement/marker. Never overwrite an existing file's bytes.
  var checked = coverFile_(c,file.getId(),productId,photo.sha256,true,folder);
  if (checked.marker && checked.marker.commandId !== commandId) failure_('BINDING_MISMATCH');
  if (!checked.marker) {
    var marker = JSON.parse(marker_(c,'cover')); marker.productId = productId; marker.commandId = commandId; marker.sha256 = photo.sha256;
    file.setDescription(JSON.stringify(marker));
  }
  coverFile_(c,file.getId(),productId,photo.sha256,false,folder);
  return file.getId();
}
function readCoverPhoto_(c, row) {
  coverPhotosEnabled_();
  if (!row.Capa_Drive_ID) failure_('CATALOG_NOT_FOUND');
  var cover = coverFile_(c,row.Capa_Drive_ID,row.ID_Produto,null,false);
  return {bytes:cover.bytes,sha256:cover.sha256};
}
