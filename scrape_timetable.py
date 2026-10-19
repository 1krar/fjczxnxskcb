"""Export the signed-in student's timetable using the school's weekly JSON API.

The student completes SSO in the opened Chrome window. The script changes
weeks once each; it does not open individual course cards or store credentials.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import re

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "2026-2027-1_虚拟现实技术应用_全部班级.json"
LOGIN_URL = (
    "https://sso1.fjcpc.edu.cn/casx/#/login?redirect_uri="
    "aHR0cHM6Ly9zc28xLmZqY3BjLmVkdS5jbi9zc294L2F1dGh6L29hdXRoL2F1dGhvcml6ZT9"
    "jbGllbnRfaWQ9NDljYWJiMDUtODFiNi00MmE0LTk5YmYtMzAxNTFmZmYxNjM0JnJlc3BvbnNlX3R5cGU9"
    "Y29kZSZyZWRpcmVjdF91cmk9aHR0cHM6Ly9hcHAuZmpjcGMuZWR1LmNuL2N6bW9iaWxlL3NzbyZhcHBy"
    "b3ZhbF9wcm9tcHQ9YXV0byZzdGF0ZT0vbXl0aW1ldGFibGVJbmRleE5ldw"
)
COURSE_PATH = "/gateway/xgwork/appCourseTable/getListByNoWeek2"


def is_course_response(response) -> bool:
    return response.url.split("?", 1)[0].endswith(COURSE_PATH) and response.status == 200


def parse_week(payload: dict, week: int) -> list[dict]:
    if payload.get("code") != 200 and payload.get("code") != 0:
        raise ValueError(f"第{week}周接口返回错误代码：{payload.get('code')}")
    grid = payload.get("data")
    if not isinstance(grid, list) or len(grid) != 7:
        raise ValueError(f"第{week}周接口格式与预期不符")
    sections: list[dict] = []
    for weekday, day in enumerate(grid, 1):
        if not isinstance(day, list):
            raise ValueError(f"第{week}周星期{weekday}的数据格式不正确")
        for cell in day:
            if not cell:
                continue
            parts = cell.split("|")
            if len(parts) != 9:
                raise ValueError(f"第{week}周存在字段数异常的课程")
            name, location, class_name, teacher, section, day_number, _, _, course_id = parts
            if int(day_number) != weekday:
                raise ValueError(f"第{week}周存在星期不匹配的课程")
            sections.append({
                "week": week,
                "weekday": weekday,
                "start_section": int(section),
                "end_section": int(section),
                "course_name": name.strip(),
                "location": location.strip(),
                "teacher": teacher.strip(),
                "class_name": class_name.strip(),
                "course_id": course_id.strip(),
            })
    sections.sort(key=lambda r: (r["weekday"], r["start_section"], r["course_id"]))
    merged: list[dict] = []
    for row in sections:
        previous = merged[-1] if merged else None
        if previous and all(previous[key] == row[key] for key in (
            "week", "weekday", "course_name", "location", "teacher", "class_name", "course_id"
        )) and previous["end_section"] + 1 == row["start_section"]:
            previous["end_section"] = row["end_section"]
        else:
            merged.append(row.copy())
    return merged


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    semester = source["semester"]
    semester_start = date.fromisoformat(source["semester_start"])
    school_year, term = semester.rsplit("-", 1)
    expected_title = f"{school_year}({term})"
    initial_responses = []

    with sync_playwright() as playwright:
        print("正在打开浏览器…", flush=True)
        browser = playwright.chromium.launch(channel="chrome", headless=False)
        try:
            context = browser.new_context(viewport={"width": 1200, "height": 900})
            context.on("response", lambda response: initial_responses.append(response) if is_course_response(response) else None)
            page = context.new_page()
            print("请在浏览器中自行登录并完成验证；进入课表后会自动抓取各周数据。", flush=True)
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_url("**/czmobile/mytimetableIndexNew", timeout=600000)
            page.locator("ul.stage_1").wait_for(state="visible", timeout=30000)
            if expected_title not in page.title():
                raise RuntimeError(f"网页学期与本地数据不一致：{page.title()} / {semester}")

            week_button = page.get_by_role("button", name=re.compile(r"第\d+周"))
            current_week = int(re.search(r"第(\d+)周", week_button.inner_text()).group(1))
            week_button.click()
            weeks = sorted({int(n) for n in re.findall(r"第(\d+)周", page.get_by_role("menu").inner_text())})
            week_button.click()
            if not weeks or not initial_responses:
                raise RuntimeError("网页没有返回可用的周次或课表接口。")

            by_week = {current_week: initial_responses[-1].json()}
            for week in weeks:
                if week == current_week:
                    continue
                week_button.click()
                try:
                    with page.expect_response(is_course_response, timeout=15000) as received:
                        page.get_by_role("menu").get_by_text(f"第{week}周", exact=True).click()
                    by_week[week] = received.value.json()
                except PlaywrightTimeoutError as exc:
                    raise RuntimeError(f"第{week}周没有收到课表接口响应，抓取已停止。") from exc
                print(f"第{week}周：已收到接口数据", flush=True)
        finally:
            browser.close()

    courses = [course for week in sorted(by_week) for course in parse_week(by_week[week], week)]
    class_names = [r["class_name"] for r in courses if r["class_name"] and r["class_name"] != "无"]
    if not courses or not class_names:
        raise RuntimeError("接口没有返回可用课程，未生成数据文件。")
    class_name = Counter(class_names).most_common(1)[0][0]
    for row in courses:
        row["class_name"] = class_name
        course_date = semester_start + timedelta(days=(row["week"] - 1) * 7 + row["weekday"] - 1)
        row["date"] = course_date.isoformat()
        row["season"] = "summer" if 6 <= course_date.month <= 9 else "winter"
        row["season_name"] = "夏季" if row["season"] == "summer" else "冬季"

    result = {key: source[key] for key in (
        "semester", "semester_start", "season_mode", "season_rule", "section_times"
    )}
    result.update({
        "updated_at": datetime.now().astimezone().isoformat(),
        "first_week": min(row["week"] for row in courses),
        "last_week": max(row["week"] for row in courses),
        "classes": {class_name: {
            "class_id": source["classes"].get(class_name, {}).get("class_id", ""),
            "courses": courses,
        }},
    })
    output = ROOT / "data" / f"{semester}_{class_name}_个人课表_新抓取.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已保存 {len(courses)} 次课程到：{output}", flush=True)


if __name__ == "__main__":
    main()
