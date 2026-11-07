/**
 * ============================================================================
 * Seed employees (Google Apps Script) — run once from the editor.
 * ============================================================================
 * Adds employees to the Employees sheet. The PIN is stored as a SHA-256 hash
 * (a real system would use per-user salts / a proper auth provider).
 *
 * HOW TO USE:
 *  1. Open your Apps Script project, create a new file "SeedEmployees.gs".
 *  2. Paste this file. Set SPREADSHEET_ID (or reuse the one in Code.gs).
 *  3. Insert your employees below, then Run > seedEmployees().
 * ============================================================================
 */
function seedEmployees() {
  var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
  if (SPREADSHEET_ID === "YOUR_SPREADSHEET_ID") { throw new Error("Set SPREADSHEET_ID"); }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Employees");
  if (!sheet) throw new Error("Run setup() first so the Employees sheet exists.");
  var lastRow = sheet.getLastRow();
  var rows = sheet.getRange(2, 1, Math.max(0, lastRow - 1), 4).getValues();

  var employees = [
    { email: "juan.reyes@oricle.com",  name: "Juan Reyes",   pin: "1234" },
    { email: "ana.santos@oricle.com",  name: "Ana Santos",   pin: "9999" },
    { email: "demo@oricle.local",      name: "Demo Employee", pin: "1234" },
  ];

  employees.forEach(function (e) {
    // skip if email already present
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === e.email.toLowerCase()) return;
    }
    var pinHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, e.pin)
      .map(function (b) { return ("0" + ((b & 0xff).toString(16))).slice(-2); }).join("");
    sheet.appendRow([e.email, e.name, pinHash, true]);
  });

  SpreadsheetApp.getUi ? SpreadsheetApp.getUi().alert("Seeded " + employees.length + " employees.") : Logger.log("Seeded employees.");
}
