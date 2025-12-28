// schema/PluginSpecSchema.js
// Plugin 自述文件（manifest/spec）Schema：給 pluginsManager 解析與註冊表建立用
// 重點：
// - Schema 只描述「自述文件」，不描述 plugin 內部實作
// - requirements = 硬條件；cost/risk = resolver 打分用
// - 支援 strategy.capabilities（策略可只提供部分能力）
// - 支援 dependencies（必需/可選/條件式依賴）

const SEMVER_REGEX =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";

module.exports = {
  $id: "https://example.local/schemas/plugins/PluginSpec.schema.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "PluginSpec",
  description:
    "pluginsManager 用的插件自述文件規格（manifest/spec）。用於掃描、驗證、註冊、策略選擇（resolver）與啟動（executor）流程。",
  type: "object",
  additionalProperties: false,

  required: ["apiVersion", "kind", "id", "name", "version", "capabilities", "strategies"],

  properties: {
    apiVersion: {
      type: "string",
      const: "plugins.demon/v1",
      description: "規格版本（固定值）。用於未來 schema 升級相容判斷。",
    },

    kind: {
      type: "string",
      const: "Plugin",
      description: "資源種類（固定值）。",
    },

    id: {
      type: "string",
      pattern: "^[a-z][a-z0-9_.-]{1,63}$",
      description:
        "插件全域唯一 ID（2~64 字元）。建議使用小寫與分隔符號（_.-），不可有空白。例：llm、asr、weather。",
    },

    name: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "插件顯示名稱（人類可讀）。",
    },

    version: {
      type: "string",
      pattern: SEMVER_REGEX,
      description: "插件版本（SemVer）。例：1.2.0、1.2.0-beta.1。",
    },

    description: {
      type: "string",
      maxLength: 2000,
      description: "插件功能簡述（可選，但建議填）。",
    },

    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      description:
        "插件提供的抽象能力清單（建議用能力命名空間，而不是實作名）。例：llm.chat、asr.transcribe、weather.forecast。",
      items: {
        type: "string",
        pattern: "^[a-z][a-z0-9_.-]*(\\.[a-z][a-z0-9_.-]*)+$",
      },
    },

    strategies: {
      type: "array",
      minItems: 1,
      description:
        "同一插件可提供多個策略（strategy）。resolver 會基於 requirements（硬條件）與 cost/risk（打分）挑選最佳策略。",
      items: { $ref: "#/$defs/StrategySpec" },
    },

    dependencies: {
      $ref: "#/$defs/DependenciesSpec",
      description:
        "插件依賴設定（可選）。支援必需依賴、可選依賴、條件式依賴（只在特定 capability/策略/情境下才需要）。",
    },

    integrity: {
      type: "object",
      additionalProperties: false,
      description:
        "供應鏈安全欄位（可選）。用於之後做 hash / signature 驗證，避免插件被替換或污染。",
      properties: {
        sha256: {
          type: "string",
          pattern: "^[A-Fa-f0-9]{64}$",
          description: "插件包或 manifest 的 SHA-256（hex）。",
        },
        signature: {
          type: "string",
          maxLength: 4096,
          description: "數位簽章（base64/hex/armored 皆可，格式由你後續定義）。",
        },
      },
    },

    metadata: {
      type: "object",
      description:
        "非決策用的描述性資訊（可選）。例如作者、repo、license、tags。resolver 不應依賴這裡做選擇。",
      additionalProperties: true,
      properties: {
        author: { type: "string", description: "作者或維護者名稱（可選）。" },
        license: { type: "string", description: "授權（可選）。" },
        repository: { type: "string", description: "repo URL 或識別（可選）。" },
        tags: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 40 },
          description: "標籤（可選）。",
        },
      },
    },
  },

  $defs: {
    // =======================
    // Strategy
    // =======================
    StrategySpec: {
      type: "object",
      additionalProperties: false,
      required: ["id", "executor", "entry", "priority", "requirements", "cost"],

      description:
        "策略（strategy）是 resolver 的決策單位。每個策略描述：用哪種 executor、怎麼啟動（entry）、硬條件（requirements）、成本估計（cost）、風險（risk）。",

      properties: {
        id: {
          type: "string",
          pattern: "^[a-z][a-z0-9_.-]{1,63}$",
          description:
            "策略 ID（同一插件內唯一）。例：local-llamacpp、remote-dgx、worker-fast。",
        },

        executor: {
          type: "string",
          enum: ["in_process", "worker", "child_process", "remote"],
          description:
            "執行器類型：in_process（同進程）、worker（worker_threads）、child_process（子程序隔離）、remote（遠端服務）。",
        },

        capabilities: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          description:
            "（可選）此策略實際支援的能力子集合。若未提供，視為支援 plugin.capabilities 全部。用於『同一插件不同策略支援不同功能』的情境。",
          items: {
            type: "string",
            pattern: "^[a-z][a-z0-9_.-]*(\\.[a-z][a-z0-9_.-]*)+$",
          },
        },

        entry: {
          type: "object",
          description:
            "啟動入口定義。會依 executor 類型不同而要求不同欄位（schema 會用 if/then 約束）。",
        },

        priority: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description:
            "人工優先權（0~100）。resolver 打分時會強烈參考。越大越優先。",
        },

        requirements: { $ref: "#/$defs/RequirementsSpec" },

        cost: { $ref: "#/$defs/CostSpec" },

        riskClass: {
          type: "integer",
          minimum: 0,
          maximum: 3,
          default: 0,
          description:
            "風險等級（0~3）：0=穩定、1=一般、2=偏高、3=高風險。resolver/policy 可用來扣分或禁用。",
        },

        isExperimental: {
          type: "boolean",
          default: false,
          description:
            "是否屬於實驗性策略。policy 可選擇在 production 禁用或大幅扣分。",
        },

        healthcheck: {
          $ref: "#/$defs/HealthSpec",
          description:
            "健康檢查設定（可選）。用于啟動後確認是否可服務，以及 degraded/fallback 觸發。",
        },

        limits: {
          $ref: "#/$defs/LimitsSpec",
          description:
            "資源與並發限制（可選）。用於 manager 做節流、排程與保護。",
        },

        fallback: {
          type: "array",
          uniqueItems: true,
          default: [],
          description:
            "降級策略鏈（strategy id 列表，依序嘗試）。當啟動失敗或健康檢查失敗時觸發。",
          items: { type: "string", pattern: "^[a-z][a-z0-9_.-]{1,63}$" },
        },
      },

      // 依 executor 約束 entry 格式
      allOf: [
        {
          if: { properties: { executor: { const: "in_process" } } },
          then: { properties: { entry: { $ref: "#/$defs/EntryInProcessSpec" } } },
        },
        {
          if: { properties: { executor: { const: "worker" } } },
          then: { properties: { entry: { $ref: "#/$defs/EntryWorkerSpec" } } },
        },
        {
          if: { properties: { executor: { const: "child_process" } } },
          then: { properties: { entry: { $ref: "#/$defs/EntryChildProcessSpec" } } },
        },
        {
          if: { properties: { executor: { const: "remote" } } },
          then: { properties: { entry: { $ref: "#/$defs/EntryRemoteSpec" } } },
        },
      ],
    },

    // =======================
    // Entry Specs
    // =======================
    EntryInProcessSpec: {
      type: "object",
      additionalProperties: false,
      required: ["module", "export"],
      description:
        "in_process 啟動入口：在同一 Node 進程內 require/import 模組並呼叫 export 的工廠函式。",
      properties: {
        module: {
          type: "string",
          minLength: 1,
          description: "入口模組路徑（相對於插件根目錄）。例：./dist/index.js",
        },
        export: {
          type: "string",
          minLength: 1,
          description: "導出的工廠函式名稱。例：createPlugin",
        },
      },
    },

    EntryWorkerSpec: {
      type: "object",
      additionalProperties: false,
      required: ["module"],
      description:
        "worker 啟動入口：worker_threads 將載入該 module 作為 worker 腳本（或透過一個通用 worker wrapper）。",
      properties: {
        module: {
          type: "string",
          minLength: 1,
          description:
            "Worker 腳本路徑（相對於插件根目錄）。例：./dist/worker.js 或 ./dist/index.js（配合 wrapper）。",
        },
      },
    },

    EntryChildProcessSpec: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      description:
        "child_process 啟動入口：以命令列方式啟動，通常用於 Python、GPU 推論或需要崩潰隔離的工作。",
      properties: {
        command: {
          type: "string",
          minLength: 1,
          description: "要執行的命令或可執行檔路徑。例：python、./bin/asr.exe",
        },
        args: {
          type: "array",
          default: [],
          description: "命令參數（可選）。",
          items: { type: "string" },
        },
        cwd: {
          type: "string",
          description: "子程序工作目錄（可選）。預設為插件根目錄。",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "子程序額外環境變數（可選）。",
        },
        stdio: {
          type: "string",
          enum: ["pipe", "inherit", "ignore"],
          default: "pipe",
          description:
            "stdio 模式（可選）。pipe 方便 IPC；inherit 方便除錯；ignore 最乾淨但不可觀測。",
        },
      },
    },

    EntryRemoteSpec: {
      type: "object",
      additionalProperties: false,
      required: ["endpoint", "protocol"],
      description:
        "remote 啟動入口：連到遠端服務。protocol 建議先從 http-json 做起，後續再加 ws/grpc。",
      properties: {
        endpoint: {
          type: "string",
          minLength: 1,
          description: "遠端服務端點。例：http://10.0.0.5:8080",
        },
        protocol: {
          type: "string",
          enum: ["http-json", "ws-json", "grpc"],
          description: "通訊協定類型。",
        },
        // 依你裁決：先不做 auth 欄位（LAN-only）
      },
    },

    // =======================
    // Dependencies
    // =======================
    DependenciesSpec: {
      type: "object",
      additionalProperties: false,
      description:
        "依賴設定：required/optional/conditional。conditional 用於『不是所有時候都會開啟所有插件』的情境（按能力需求或策略選擇才引入）。",
      properties: {
        required: {
          type: "array",
          default: [],
          description:
            "必需依賴：沒有滿足就不應啟用（或該策略直接淘汰）。",
          items: { $ref: "#/$defs/DependencySpec" },
        },
        optional: {
          type: "array",
          default: [],
          description:
            "可選依賴：滿足則啟用增強功能，不滿足也可運作。",
          items: { $ref: "#/$defs/DependencySpec" },
        },
        conditional: {
          type: "array",
          default: [],
          description:
            "條件式依賴：只有在特定能力被要求（或特定策略被選中）時才需要。適合做『lazy enable』。",
          items: { $ref: "#/$defs/ConditionalDependencySpec" },
        },
      },
    },

    DependencySpec: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      description:
        "單筆依賴：可以依賴『特定 plugin id』或依賴『某個 capability（由任何插件提供皆可）』。",
      properties: {
        type: {
          type: "string",
          enum: ["plugin", "capability"],
          description:
            "依賴類型：plugin=指定插件；capability=指定能力（允許由任意提供者滿足）。",
        },

        // type=plugin
        pluginId: {
          type: "string",
          pattern: "^[a-z][a-z0-9_.-]{1,63}$",
          description:
            "（type=plugin）被依賴的插件 ID。例：calendar、toolReference。",
        },

        // type=capability
        capability: {
          type: "string",
          pattern: "^[a-z][a-z0-9_.-]*(\\.[a-z][a-z0-9_.-]*)+$",
          description:
            "（type=capability）被依賴的能力。例：calendar.query、weather.forecast。",
        },

        version: {
          type: "string",
          description:
            "版本約束（可選）：對 plugin 依賴可使用 semver range 字串（實際解析由 manager 實作）。例：>=1.2.0",
        },

        reason: {
          type: "string",
          maxLength: 500,
          description: "依賴原因說明（可選）。有助於除錯與可視化。",
        },
      },
      allOf: [
        {
          if: { properties: { type: { const: "plugin" } } },
          then: { required: ["pluginId"], not: { required: ["capability"] } },
        },
        {
          if: { properties: { type: { const: "capability" } } },
          then: { required: ["capability"], not: { required: ["pluginId"] } },
        },
      ],
    },

    ConditionalDependencySpec: {
      type: "object",
      additionalProperties: false,
      required: ["when", "requires"],
      description:
        "條件式依賴：when 條件成立才需要 requires 內的依賴。when 可依 capability 或 strategyId 控制。",
      properties: {
        when: {
          type: "object",
          additionalProperties: false,
          description:
            "條件：可用 whenCapabilities（當某能力被請求/使用時）或 whenStrategy（當某策略被選中時）。",
          properties: {
            whenCapabilities: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "string",
                pattern: "^[a-z][a-z0-9_.-]*(\\.[a-z][a-z0-9_.-]*)+$",
              },
              description:
                "當以下能力被請求/使用時，觸發依賴要求（lazy enable）。",
            },
            whenStrategy: {
              type: "string",
              pattern: "^[a-z][a-z0-9_.-]{1,63}$",
              description:
                "當指定 strategy 被選中時，觸發依賴要求（例如 remote 策略需要 network plugin）。",
            },
          },
          anyOf: [{ required: ["whenCapabilities"] }, { required: ["whenStrategy"] }],
        },

        requires: {
          type: "array",
          minItems: 1,
          description: "條件成立時必須滿足的依賴清單。",
          items: { $ref: "#/$defs/DependencySpec" },
        },
      },
    },

    // =======================
    // Requirements / Cost / Health / Limits
    // =======================
    RequirementsSpec: {
      type: "object",
      additionalProperties: false,
      required: ["platform", "runtime", "resources", "network", "env", "permissions"],
      description:
        "硬條件（requirements）。只要任一項不滿足，該 strategy 直接淘汰，不進入打分。",
      properties: {
        platform: {
          type: "object",
          additionalProperties: false,
          required: ["os", "arch"],
          description: "平台限制（硬條件）。",
          properties: {
            os: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", enum: ["win32", "darwin", "linux"] },
              description: "允許的作業系統清單。",
            },
            arch: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", enum: ["x64", "arm64"] },
              description: "允許的 CPU 架構清單。",
            },
          },
        },

        runtime: {
          type: "object",
          additionalProperties: false,
          required: ["node"],
          description: "執行時版本需求（硬條件）。",
          properties: {
            node: {
              type: "string",
              minLength: 1,
              description: "Node 版本區間字串。例：>=20（實際解析由 manager 實作）。",
            },
          },
        },

        resources: {
          type: "object",
          additionalProperties: false,
          required: ["gpu"],
          description: "資源需求（硬條件）。",
          properties: {
            gpu: { type: "boolean", description: "是否必須有 GPU。" },
            cuda: {
              type: "string",
              description: "CUDA 版本需求（可選）。例：>=11.8（解析由 manager 實作）。",
            },
            vramMBMin: {
              type: "integer",
              minimum: 0,
              description: "最低 VRAM（MB，可選）。",
            },
            ramMBMin: {
              type: "integer",
              minimum: 0,
              description: "最低 RAM（MB，可選）。",
            },
          },
        },

        network: {
          type: "object",
          additionalProperties: false,
          required: ["requiresInternet", "requiresLan"],
          description: "網路需求（硬條件）。",
          properties: {
            requiresInternet: { type: "boolean", description: "是否需要可用的外網。" },
            requiresLan: { type: "boolean", description: "是否需要可用的內網（LAN）。" },
          },
        },

        env: {
          type: "object",
          additionalProperties: false,
          required: ["required"],
          description: "環境變數要求（硬條件）。",
          properties: {
            required: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", minLength: 1 },
              description: "必須存在的環境變數 key 清單。",
            },
          },
        },

        permissions: {
          type: "object",
          additionalProperties: false,
          required: ["fsRead", "fsWrite", "net", "spawn"],
          description:
            "權限需求（建議視為硬條件）。manager policy 若不允許，直接淘汰。",
          properties: {
            fsRead: {
              type: "array",
              default: [],
              items: { type: "string", minLength: 1 },
              description: "允許讀取的路徑/規則清單（glob/paths）。",
            },
            fsWrite: {
              type: "array",
              default: [],
              items: { type: "string", minLength: 1 },
              description: "允許寫入的路徑/規則清單（glob/paths）。",
            },
            net: {
              type: "array",
              default: [],
              items: { type: "string", minLength: 1 },
              description:
                "允許連線的主機/網段清單（host 或 CIDR 字串）。目前不強制格式，由 policy 決定。",
            },
            spawn: {
              type: "boolean",
              description: "是否允許再 spawn 子程序（供安全策略使用）。",
            },
          },
        },
      },
    },

    CostSpec: {
      type: "object",
      additionalProperties: false,
      required: ["startupMs", "latencyMsP50", "latencyMsP95", "memoryMB", "gpuMB", "stabilityRisk"],
      description:
        "成本估計（用於 resolver 打分，不是硬條件）。數值越大通常越差，stabilityRisk 越高代表越不穩。",
      properties: {
        startupMs: { type: "integer", minimum: 0, description: "啟動時間估計（毫秒）。" },
        latencyMsP50: { type: "integer", minimum: 0, description: "延遲 P50 估計（毫秒）。" },
        latencyMsP95: { type: "integer", minimum: 0, description: "延遲 P95 估計（毫秒）。" },
        memoryMB: { type: "integer", minimum: 0, description: "記憶體占用估計（MB）。" },
        gpuMB: { type: "integer", minimum: 0, description: "GPU/VRAM 占用估計（MB）。" },
        stabilityRisk: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "穩定性風險（0~1）。0=很穩；1=很容易出事。可人工填或由統計回寫。",
        },
        notes: { type: "string", maxLength: 1000, description: "成本估計備註（可選）。" },
      },
    },

    HealthSpec: {
      type: "object",
      additionalProperties: false,
      description: "健康檢查設定（可選）。",
      properties: {
        type: {
          type: "string",
          enum: ["none", "ping", "http", "custom"],
          default: "none",
          description: "健康檢查類型。",
        },
        intervalMs: {
          type: "integer",
          minimum: 1000,
          default: 10000,
          description: "檢查頻率（毫秒）。",
        },
        timeoutMs: {
          type: "integer",
          minimum: 500,
          default: 2000,
          description: "單次檢查逾時（毫秒）。",
        },
        endpoint: {
          type: "string",
          description:
            "health endpoint（可選）。remote/http 模式常用，例如 /healthz。",
        },
      },
    },

    LimitsSpec: {
      type: "object",
      additionalProperties: false,
      description: "資源/並發限制（可選）。",
      properties: {
        maxConcurrency: {
          type: "integer",
          minimum: 1,
          default: 1,
          description: "同一策略允許的最大並發請求數。",
        },
        maxQueue: {
          type: "integer",
          minimum: 0,
          default: 100,
          description: "超出並發時允許排隊的最大數量。",
        },
      },
    },
  },
};
