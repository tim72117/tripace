import Foundation
import SQLite3

// 系統內建 SQLite 的薄包裝(零第三方依賴)。
// 只提供本專案本地快取需要的最小功能:開檔、執行 SQL、prepared statement 綁參數與取值。

/// SQLITE_TRANSIENT:告訴 SQLite 複製傳入的 bytes(綁字串/blob 時必須,否則指標失效會讀到亂碼)。
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum SQLiteError: LocalizedError {
    case open(String)
    case prepare(String)
    case step(String)

    var errorDescription: String? {
        switch self {
        case .open(let m): return "開啟資料庫失敗:\(m)"
        case .prepare(let m): return "SQL 準備失敗:\(m)"
        case .step(let m): return "SQL 執行失敗:\(m)"
        }
    }
}

/// 單一 SQLite 連線。非執行緒安全 —— 由呼叫端(LocalStore,@MainActor)序列化存取。
final class SQLiteDatabase {
    private let handle: OpaquePointer

    init(path: String) throws {
        var h: OpaquePointer?
        guard sqlite3_open(path, &h) == SQLITE_OK, let h else {
            let msg = h.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            if let h { sqlite3_close(h) }
            throw SQLiteError.open(msg)
        }
        handle = h
        // WAL:讀寫並行更好,且寫入更耐當機(local-first 快取的合理預設)。
        sqlite3_exec(handle, "PRAGMA journal_mode=WAL;", nil, nil, nil)
        sqlite3_exec(handle, "PRAGMA foreign_keys=ON;", nil, nil, nil)
    }

    deinit { sqlite3_close(handle) }

    private var lastError: String { String(cString: sqlite3_errmsg(handle)) }

    /// 執行不回傳資料列的 SQL(建表、PRAGMA、含多句的 schema)。
    func execute(_ sql: String) throws {
        if sqlite3_exec(handle, sql, nil, nil, nil) != SQLITE_OK {
            throw SQLiteError.step(lastError)
        }
    }

    /// 執行一句帶參數的寫入(INSERT/UPDATE/DELETE/UPSERT)。
    func run(_ sql: String, _ params: [SQLiteValue] = []) throws {
        let stmt = try prepare(sql, params)
        defer { sqlite3_finalize(stmt) }
        if sqlite3_step(stmt) != SQLITE_DONE {
            throw SQLiteError.step(lastError)
        }
    }

    /// 執行查詢,把每列交給 rowMap 轉成 T。
    func query<T>(_ sql: String, _ params: [SQLiteValue] = [], rowMap: (Row) -> T) throws -> [T] {
        let stmt = try prepare(sql, params)
        defer { sqlite3_finalize(stmt) }
        var out: [T] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            out.append(rowMap(Row(stmt: stmt)))
        }
        return out
    }

    /// 在交易中執行 body;body 丟錯則 rollback,否則 commit。批次寫入用,確保全有或全無。
    func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN;")
        do {
            try body()
            try execute("COMMIT;")
        } catch {
            try? execute("ROLLBACK;")
            throw error
        }
    }

    private func prepare(_ sql: String, _ params: [SQLiteValue]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw SQLiteError.prepare(lastError)
        }
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            switch p {
            case .null:
                sqlite3_bind_null(stmt, idx)
            case .int(let v):
                sqlite3_bind_int64(stmt, idx, v)
            case .double(let v):
                sqlite3_bind_double(stmt, idx, v)
            case .text(let v):
                sqlite3_bind_text(stmt, idx, v, -1, SQLITE_TRANSIENT)
            }
        }
        return stmt
    }
}

/// 綁定參數的值型別。
enum SQLiteValue {
    case null
    case int(Int64)
    case double(Double)
    case text(String)

    static func text(_ v: String?) -> SQLiteValue { v.map { .text($0) } ?? .null }
    static func bool(_ v: Bool) -> SQLiteValue { .int(v ? 1 : 0) }
}

/// 查詢結果的一列,提供依欄位索引取值的 helper。
struct Row {
    let stmt: OpaquePointer

    func text(_ i: Int32) -> String {
        guard let c = sqlite3_column_text(stmt, i) else { return "" }
        return String(cString: c)
    }
    func textOptional(_ i: Int32) -> String? {
        guard sqlite3_column_type(stmt, i) != SQLITE_NULL,
              let c = sqlite3_column_text(stmt, i) else { return nil }
        return String(cString: c)
    }
    func int(_ i: Int32) -> Int64 { sqlite3_column_int64(stmt, i) }
    func bool(_ i: Int32) -> Bool { sqlite3_column_int64(stmt, i) != 0 }
    func double(_ i: Int32) -> Double { sqlite3_column_double(stmt, i) }
}
