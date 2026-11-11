"""壓力測試用的模擬資料集生成腳本。

用法（於專案根目錄執行）：
    python -m benchmarks.generate_data            # 預設生成 500 萬筆
    python -m benchmarks.generate_data 20000      # 指定筆數
"""
import os
import sys

import numpy as np
import pandas as pd

from benchmarks.utils import SCRATCH_DIR


def generate_mock_dataset(num_rows: int) -> pd.DataFrame:
    """生成混合型別模擬資料集（10 個欄位，可產生至 500 萬筆）"""
    np.random.seed(42)

    # 1. 姓名生成
    first_names = [
        "陳",
        "林",
        "黃",
        "張",
        "李",
        "王",
        "吳",
        "劉",
        "蔡",
        "楊",
        "許",
        "鄭",
        "謝",
        "洪",
        "郭",
        "邱",
        "曾",
        "廖",
        "賴",
        "徐",
        "周",
        "葉",
        "蘇",
        "莊",
        "江",
        "呂",
        "何",
        "羅",
        "高",
        "蕭",
        "潘",
        "朱",
        "簡",
        "彭",
        "游",
        "詹",
        "胡",
        "施",
        "沈",
        "余",
        "盧",
        "梁",
        "趙",
        "顏",
        "柯",
        "翁",
        "魏",
        "孫",
        "戴",
        "范",
        "方",
        "宋",
        "鄧",
        "杜",
        "傅",
        "侯",
        "曹",
        "薛",
        "丁",
        "卓",
        "阮",
        "馬",
        "董",
        "唐",
        "温",
        "藍",
        "石",
        "蔣",
        "古",
        "紀",
        "姚",
        "連",
        "馮",
        "歐",
        "程",
        "湯",
        "黄",
        "田",
        "康",
        "姜",
        "汪",
        "白",
        "鄒",
        "尤",
        "巫",
        "鐘",
        "黎",
        "涂",
        "龔",
        "嚴",
        "韓",
        "袁",
        "金",
        "童",
        "陸",
        "夏",
        "柳",
        "凃",
        "邵",
    ]
    seeds_1 = [
        "冠",
        "宗",
        "家",
        "彥",
        "承",
        "宇",
        "浩",
        "翔",
        "柏",
        "奕",
        "品",
        "若",
        "詩",
        "美",
        "雅",
        "佳",
        "子",
        "梓",
        "睿",
        "軒",
        "銘",
        "展",
        "建",
        "俊",
        "志",
        "文",
        "明",
        "淑",
        "麗",
        "華",
    ]
    seeds_2 = [
        "宇",
        "翰",
        "豪",
        "廷",
        "軒",
        "然",
        "勛",
        "霖",
        "瑞",
        "辰",
        "涵",
        "妤",
        "婷",
        "晴",
        "琪",
        "萱",
        "茹",
        "茵",
        "潔",
        "珊",
        "強",
        "輝",
        "宏",
        "偉",
        "平",
        "生",
        "梅",
        "芳",
        "秀",
        "玲",
    ]
    last_names = [f"{s1}{s2}" for s1 in seeds_1 for s2 in seeds_2 if s1 != s2]

    names_combined = np.char.add(
        np.random.choice(first_names, size=num_rows),
        np.random.choice(last_names, size=num_rows),
    )

    # 2. 身分證號
    id_locations = {
        "A": 10,
        "B": 11,
        "C": 12,
        "D": 13,
        "E": 14,
        "F": 15,
        "G": 16,
        "H": 17,
        "J": 18,
        "K": 19,
        "L": 20,
        "M": 21,
        "N": 22,
        "P": 23,
        "Q": 24,
        "R": 25,
        "S": 26,
        "T": 27,
        "U": 28,
        "V": 29,
        "X": 30,
        "Y": 31,
        "W": 32,
        "Z": 33,
        "I": 34,
        "O": 35,
    }

    def _gen_single_safe_id():
        letter = np.random.choice(list(id_locations.keys()))
        nums = np.random.randint(0, 10, size=8)
        n12 = id_locations[letter]
        total = (n12 // 10) + (n12 % 10) * 9 + 3 * 8  # 固定性別代碼 3
        for i in range(7):
            total += nums[i] * (7 - i)
        checksum = (10 - (total % 10)) % 10
        return f"{letter}3{''.join(map(str, nums[:7]))}{checksum}"

    id_pool = [_gen_single_safe_id() for _ in range(50000)]
    id_numbers = np.random.choice(id_pool, size=num_rows)

    # 3. 基礎欄位
    ages = np.random.randint(18, 90, size=num_rows)
    chosen_areas = np.random.choice(
        ["大安區", "中正區", "板橋區", "苓雅區"], size=num_rows
    )
    chosen_diseases = np.random.choice(
        ["感冒", "高血壓", "心臟病", "糖尿病", "過敏"], size=num_rows
    )
    salaries = np.random.randint(25000, 150000, size=num_rows)

    # 4. 生日生成
    years = 2026 - ages
    months = np.random.randint(1, 13, size=num_rows)
    days = np.random.randint(1, 29, size=num_rows)
    birthdays = [f"{y}-{m:02d}-{d:02d}" for y, m, d in zip(years, months, days)]

    # 5. 職業、婚姻狀況、就醫次數
    occupations = [
        "工程師",
        "教師",
        "醫師",
        "公務員",
        "學生",
        "服務業",
        "自由業",
        "退休",
    ]
    marital_status = ["單身", "已婚", "離婚", "喪偶"]

    data = {
        "姓名": names_combined,
        "身分證號": id_numbers,
        "年齡": ages,
        "地區": chosen_areas,
        "生日": birthdays,
        "疾病": chosen_diseases,
        "薪資": salaries,
        "職業": np.random.choice(occupations, size=num_rows),
        "婚姻狀況": np.random.choice(marital_status, size=num_rows),
        "就醫次數": np.random.randint(0, 20, size=num_rows),
    }

    return pd.DataFrame(data)


def main():
    # 筆數由第一個指令列參數指定，未指定時為 500 萬
    num_rows = int(sys.argv[1]) if len(sys.argv) > 1 else 5000000

    # 輸出位置以專案根目錄推得，不寫死開發機的絕對路徑，換一台機器執行也落在同一處
    os.makedirs(SCRATCH_DIR, exist_ok=True)

    # 直接生成指定數量的資料
    print(f"[...] generating {num_rows:,} rows of test data...")
    df = generate_mock_dataset(num_rows)

    # 儲存檔案
    output_path = SCRATCH_DIR / f"test_data_{num_rows // 1000}k.csv"
    df.to_csv(output_path, index=False, encoding="utf-8")

    print("[OK] Test data generated successfully!")
    print(f"   -> Dataset: {output_path}")
    print("   -> Config:  benchmarks/config_kanon_5m.json、benchmarks/config_dp_5m.json")


if __name__ == "__main__":
    main()
