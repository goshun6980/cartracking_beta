/**
 * 運行状況アプリ用 GASバックエンドコード (完全版・無料入構＆アイコン対応)
 */
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return makeJsonResponse({ ok: false, error: "サーバーが混雑しています。時間をおいて再試行してください。" });
  }

  try {
    var params = e.parameter || {};
    var action = params.action;
    var payload = {};

    if (params.payload) {
      try {
        payload = JSON.parse(params.payload);
      } catch (ex) { }
    }

    if (action === "getVehicles") {
      return makeJsonResponse({ ok: true, vehicles: getVehiclesFromSheet() });
    } else if (action === "updatePosition") {
      updatePositionInSheet(payload.vehicleId, payload.log);
      return makeJsonResponse({ ok: true });
    } else if (action === "recordGateEvent") {
      recordGateEventInSheet(payload.vehicleId, payload.eventType, payload.gateName, payload.timestamp);
      return makeJsonResponse({ ok: true });
    } else if (action === "saveVehicle") {
      saveVehicleToSheet(payload.vehicle);
      return makeJsonResponse({ ok: true });
    } else if (action === "deleteVehicle") {
      deleteVehicleFromSheet(payload.id);
      return makeJsonResponse({ ok: true });
    } else if (action === "setVehicleOnline") {
      setVehicleOnlineInSheet(payload.id, payload.online);
      return makeJsonResponse({ ok: true });
    } else if (action === "setVehicleInfiniteTime") {
      setVehicleInfiniteTimeInSheet(payload.id, payload.infiniteTime);
      return makeJsonResponse({ ok: true });
    } else if (action === "getHistory") {
      return makeJsonResponse({ ok: true, history: getHistoryFromSheet(params.date) });
    }

    return makeJsonResponse({ ok: false, error: "無効なアクションです" });
  } catch (error) {
    return makeJsonResponse({ ok: false, error: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function makeJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDbSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getVehiclesFromSheet() {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("current");
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  var vehicles = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[0]);
    if (!id) continue;
    vehicles[id] = {
      id: id,
      name: String(row[1] || ""),
      driverName: String(row[2] || ""),
      color: String(row[3] || "#6366f1"),
      lat: Number(row[4]) || 35.1525,
      lng: Number(row[5]) || 136.9686,
      speed: Number(row[6]) || 0,
      heading: Number(row[7]) || 0,
      online: Boolean(row[8]),
      lastUpdated: row[9] ? new Date(row[9]).toISOString() : new Date().toISOString(),
      isInside: Boolean(row[10]),
      entryGateName: String(row[11] || ""),
      entryTime: row[12] ? new Date(row[12]).toISOString() : null,
      infiniteTime: Boolean(row[13]),
      iconType: String(row[14] || "airport_shuttle")
    };
  }
  return vehicles;
}

function recordGateEventInSheet(vehicleId, eventType, gateName, timestampStr) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("gate_events");
  if (!sheet) {
    sheet = ss.insertSheet("gate_events");
    sheet.appendRow(["VehicleID", "EventType", "GateName", "Timestamp"]);
  }
  sheet.appendRow([vehicleId, eventType, gateName, timestampStr]);

  var currentSheet = ss.getSheetByName("current");
  if (currentSheet) {
    var data = currentSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(vehicleId)) {
        var isInside = (eventType === 'ENTRY');
        currentSheet.getRange(i + 1, 11).setValue(isInside);
        currentSheet.getRange(i + 1, 12).setValue(isInside ? gateName : "");
        currentSheet.getRange(i + 1, 13).setValue(isInside ? timestampStr : "");
        break;
      }
    }
  }
}

function updatePositionInSheet(vehicleId, log) {
  var ss = getDbSpreadsheet();
  var currentSheet = ss.getSheetByName("current");
  if (currentSheet) {
    var data = currentSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(vehicleId)) {
        currentSheet.getRange(i + 1, 5, 1, 6).setValues([[
          log.lat, log.lng, log.speed, log.heading || 0, true, log.time
        ]]);
        break;
      }
    }
  }

  var historySheet = ss.getSheetByName("history");
  if (!historySheet) {
    historySheet = ss.insertSheet("history");
    historySheet.appendRow(["VehicleID", "Timestamp", "Speed", "Latitude", "Longitude"]);
  }
  historySheet.appendRow([vehicleId, log.time, log.speed, log.lat, log.lng]);
}

function saveVehicleToSheet(vehicle) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("current");
  if (!sheet) {
    sheet = ss.insertSheet("current");
    sheet.appendRow(["ID", "Name", "Driver", "Color", "Lat", "Lng", "Speed", "Heading", "Online", "LastUpdated", "IsInside", "EntryGate", "EntryTime", "InfiniteTime", "IconType"]);
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(vehicle.id)) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[vehicle.name, vehicle.driverName || "", vehicle.color || "#6366f1"]]);
      sheet.getRange(i + 1, 14).setValue(Boolean(vehicle.infiniteTime));
      sheet.getRange(i + 1, 15).setValue(vehicle.iconType || "airport_shuttle");
      return;
    }
  }
  sheet.appendRow([
    vehicle.id,
    vehicle.name,
    vehicle.driverName || "",
    vehicle.color || "#6366f1",
    vehicle.lat || 35.1525,
    vehicle.lng || 136.9686,
    0,
    0,
    false,
    new Date().toISOString(),
    false,
    "",
    "",
    Boolean(vehicle.infiniteTime),
    vehicle.iconType || "airport_shuttle"
  ]);
}

function deleteVehicleFromSheet(id) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("current");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

function setVehicleOnlineInSheet(id, online) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("current");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 9).setValue(online);
      break;
    }
  }
}

function setVehicleInfiniteTimeInSheet(id, infiniteTime) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("current");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 14).setValue(Boolean(infiniteTime));
      break;
    }
  }
}

function getHistoryFromSheet(dateStr) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName("history");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var logs = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    logs.push({ id: String(row[0]), time: new Date(row[1]).toISOString(), speed: Number(row[2]), lat: Number(row[3]), lng: Number(row[4]) });
  }
  return logs;
}