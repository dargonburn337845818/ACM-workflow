# -*- coding: utf-8 -*-
"""Codeforces 难度阶梯 · 独立本地小程序

技术栈：Python + PySide6
打包：PyInstaller --onefile（Windows 便携版 exe）
风格：现代圆润风（深色现代 / 浅色现代），带轻量动画开关
"""

import json
import os
import sys

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, QSize, Qt, QStandardPaths
from PySide6.QtGui import QColor, QFont, QGuiApplication, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from info_framework import (
    ANATOMY_STEPS,
    DYN_DYNAMIC,
    DYN_STATIC,
    INFO_OPS,
    INFO_OP_COLORS,
    OP_BASELINE,
    OP_ENCODE,
    OP_PROPAGATE,
    OP_PRUNE,
    OP_TRANSFORM,
    PHASES,
    TOPOLOGIES,
    get_alg_info,
)
from knowledge_data import ALGORITHMS, ALGORITHM_BY_NAME
from tiers_data import TIERS

APP_NAME = "KnowledgeLadder"
ORG_NAME = "ACMWorkflow"
WINDOW_TITLE = "Codeforces 难度阶梯"
TOTAL_TAGS = sum(len(tier["tags"]) for tier in TIERS)

STYLE_DARK = "dark"
STYLE_LIGHT = "light"
STYLE_NAMES = {STYLE_DARK: "深色现代", STYLE_LIGHT: "浅色现代"}

ANIM_OFF = "off"
ANIM_LIGHT = "light"
ANIM_SMOOTH = "smooth"
ANIM_NAMES = {ANIM_OFF: "关闭", ANIM_LIGHT: "轻量", ANIM_SMOOTH: "流畅"}


def _unique_in_order(values, order=None):
    """去重并尽量按 order 排序，保持界面标签稳定。"""
    seen = set()
    result = []
    for v in values:
        if v is None or v in seen:
            continue
        seen.add(v)
        result.append(v)
    if order:
        oi = {v: i for i, v in enumerate(order)}
        result.sort(key=lambda x: oi.get(x, len(order) + 1))
    return result


def aggregate_tag_info(tag):
    """聚合一个标签下所有算法的信息论视角，用于行内徽章和过滤。"""
    infos = []
    for name in tag.get("algorithms", []):
        alg = ALGORITHM_BY_NAME.get(name)
        if alg is not None:
            infos.append(alg.get("info", get_alg_info(name)))
    ops, topologies, dynamics, metrics = [], [], [], []
    for info in infos:
        ops.extend(info.get("ops", []))
        if info.get("topology"):
            topologies.append(info["topology"])
        if info.get("dynamic"):
            dynamics.append(info["dynamic"])
        if info.get("metric"):
            metrics.append(info["metric"])
    return {
        "ops": _unique_in_order(ops, INFO_OPS),
        "topologies": _unique_in_order(topologies, TOPOLOGIES),
        "dynamics": _unique_in_order(dynamics, [DYN_STATIC, DYN_DYNAMIC]),
        "metrics": _unique_in_order(metrics),
    }


def load_qss(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        # 打包成 exe 时，QSS 也随 PyInstaller 打进 _MEIPASS，这里做兼容
        import sys as _sys
        base = getattr(_sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(base, "style.qss"), encoding="utf-8") as f:
            return f.read()


class ProgressStore:
    """本地进度存储：使用系统 AppData 目录，Windows 上通常为 %APPDATA%。"""

    def __init__(self):
        base = QStandardPaths.writableLocation(QStandardPaths.AppDataLocation)
        if not base:
            base = os.path.join(os.path.expanduser("~"), ".knowledge-ladder")
        os.makedirs(base, exist_ok=True)
        self.path = os.path.join(base, "progress.json")
        self.mastered: dict[str, bool] = {}
        self.style_mode = STYLE_DARK
        self.animation_level = ANIM_LIGHT
        self.load()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            self.mastered = data.get("mastered", {})
            style = data.get("style_mode", STYLE_DARK)
            # 兼容旧版 hard/mac
            if style == "hard":
                style = STYLE_DARK
            elif style == "mac":
                style = STYLE_LIGHT
            self.style_mode = style if style in (STYLE_DARK, STYLE_LIGHT) else STYLE_DARK
            self.animation_level = data.get("animation_level", ANIM_LIGHT)
            if self.animation_level not in (ANIM_OFF, ANIM_LIGHT, ANIM_SMOOTH):
                self.animation_level = ANIM_LIGHT
        except (OSError, ValueError):
            self.mastered = {}
            self.style_mode = STYLE_DARK
            self.animation_level = ANIM_LIGHT

    def save(self):
        data = {
            "mastered": self.mastered,
            "style_mode": self.style_mode,
            "animation_level": self.animation_level,
            "updatedAt": "",
        }
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    def set_style_mode(self, mode: str):
        self.style_mode = mode
        self.save()

    def set_animation_level(self, level: str):
        self.animation_level = level
        self.save()

    def is_mastered(self, tag_id: str) -> bool:
        return bool(self.mastered.get(tag_id, False))

    def set_mastered(self, tag_id: str, value: bool):
        self.mastered[tag_id] = value
        self.save()

    def reset(self):
        self.mastered = {}
        self.save()

    def mastered_count(self) -> int:
        return sum(1 for v in self.mastered.values() if v)


class CodeDialog(QDialog):
    """算法模板详情对话框。"""

    def __init__(self, parent, algorithms, animation_level=ANIM_LIGHT):
        super().__init__(parent)
        self.animation_level = animation_level
        self._fade_started = False
        self.setWindowTitle("知识点详情 / C++ 模板")
        self.resize(760, 560)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        tabs = QTabWidget(self)
        for alg in algorithms:
            tab = QWidget()
            v = QVBoxLayout(tab)
            v.setContentsMargins(12, 12, 12, 12)
            v.setSpacing(8)

            quality = alg.get("quality", "complete")
            quality_text = {"complete": "完整", "skeleton": "骨架", "todo": "待补"}.get(quality, "完整")
            quality_label = QLabel(f"质量：{quality_text}")
            quality_label.setObjectName("qualityLabel")
            quality_label.setProperty("quality", quality)
            quality_label.style().unpolish(quality_label)
            quality_label.style().polish(quality_label)
            v.addWidget(quality_label, alignment=Qt.AlignmentFlag.AlignLeft)

            path_label = QLabel(f"{alg['category']} / {alg['sub']}")
            path_label.setObjectName("pathLabel")
            v.addWidget(path_label)

            info = alg.get("info", get_alg_info(alg["name"]))
            if info:
                info_parts = []
                if info.get("ops"):
                    info_parts.append(" / ".join(info["ops"]))
                if info.get("topology"):
                    info_parts.append(f"拓扑：{info['topology']}")
                if info.get("dynamic"):
                    info_parts.append(info["dynamic"])
                if info.get("metric"):
                    info_parts.append(f"度量：{info['metric']}")
                info_label = QLabel("信息论：" + " · ".join(info_parts))
                info_label.setObjectName("infoText")
                info_label.setWordWrap(True)
                v.addWidget(info_label)
                if info.get("why"):
                    why_label = QLabel("为什么：" + info["why"])
                    why_label.setObjectName("infoWhy")
                    why_label.setWordWrap(True)
                    v.addWidget(why_label)

            name_label = QLabel(alg["name"])
            name_label.setObjectName("algName")
            v.addWidget(name_label)

            intro_label = QLabel(alg["intro"])
            intro_label.setWordWrap(True)
            intro_label.setObjectName("introLabel")
            v.addWidget(intro_label)

            cplx_label = QLabel(f"复杂度：{alg['complexity']}")
            cplx_label.setObjectName("complexityLabel")
            v.addWidget(cplx_label)

            copy_btn = QPushButton("复制模板")
            copy_btn.setObjectName("copyBtn")
            copy_btn.clicked.connect(lambda checked=False, a=alg: self.copy_code(a["cpp"]))
            v.addWidget(copy_btn, alignment=Qt.AlignmentFlag.AlignLeft)

            code = QPlainTextEdit()
            code.setPlainText(alg["cpp"])
            code.setReadOnly(True)
            code.setObjectName("codeView")
            code.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
            code.setFont(QFont("Consolas", 11))
            v.addWidget(code, 1)

            tabs.addTab(tab, alg["name"])

        layout.addWidget(tabs, 1)

        close_btn = QPushButton("关闭")
        close_btn.setObjectName("closeBtn")
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn, alignment=Qt.AlignmentFlag.AlignRight)

    def showEvent(self, event):
        super().showEvent(event)
        if self.animation_level == ANIM_SMOOTH and not self._fade_started:
            self._fade_started = True
            self.setWindowOpacity(0.0)
            self._fade_anim = QPropertyAnimation(self, b"windowOpacity", self)
            self._fade_anim.setStartValue(0.0)
            self._fade_anim.setEndValue(1.0)
            self._fade_anim.setDuration(300)
            self._fade_anim.setEasingCurve(QEasingCurve.Type.OutCubic)
            self._fade_anim.start()

    def copy_code(self, code: str):
        QGuiApplication.clipboard().setText(code)
        QMessageBox.information(self, "已复制", "C++ 模板已复制到剪贴板。")


class TagRow(QFrame):
    """单个知识点行：勾选 + 名称 + 描述 + 模板/详情按钮。

    带 ``detail`` 的条目会显示“展开/收起”，把详情原地展开；
    没有关联算法的条目不再显示无效的“模板”按钮。
    """

    def __init__(self, tag, store, on_change):
        super().__init__()
        self.tag = tag
        self.store = store
        self.on_change = on_change
        self.setObjectName("tagRow")
        self._detail_open = False

        outer = QVBoxLayout(self)
        outer.setContentsMargins(10, 8, 10, 8)
        outer.setSpacing(6)

        layout = QHBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.checkbox = QCheckBox()
        self.checkbox.setChecked(store.is_mastered(tag["id"]))
        self.checkbox.stateChanged.connect(self._changed)
        layout.addWidget(self.checkbox, alignment=Qt.AlignmentFlag.AlignTop)

        text_box = QVBoxLayout()
        text_box.setSpacing(2)
        name_label = QLabel(tag["name"])
        name_label.setObjectName("tagName")
        text_box.addWidget(name_label)
        desc_label = QLabel(tag["desc"])
        desc_label.setObjectName("tagDesc")
        desc_label.setWordWrap(True)
        text_box.addWidget(desc_label)

        # 信息论徽章：操作 / 拓扑 / 动静
        self.tag_info = aggregate_tag_info(tag)
        self.info_ops = list(self.tag_info["ops"])
        if self.tag_info["ops"] or self.tag_info["topologies"] or self.tag_info["dynamics"]:
            info_row = QHBoxLayout()
            info_row.setSpacing(4)
            for op in self.tag_info["ops"]:
                badge = QLabel(op)
                badge.setObjectName("infoBadge")
                badge.setProperty("op", op)
                badge.setToolTip(f"信息操作：{op}\n{INFO_OP_COLORS.get(op, '')}")
                info_row.addWidget(badge)
            if self.tag_info["topologies"]:
                topo_badge = QLabel(" · ".join(self.tag_info["topologies"]))
                topo_badge.setObjectName("infoBadgeTopo")
                topo_badge.setToolTip("拓扑空间")
                info_row.addWidget(topo_badge)
            if self.tag_info["dynamics"]:
                dyn_badge = QLabel(" · ".join(self.tag_info["dynamics"]))
                dyn_badge.setObjectName("infoBadgeDyn")
                dyn_badge.setToolTip("静态 / 动态")
                info_row.addWidget(dyn_badge)
            info_row.addStretch(1)
            text_box.addLayout(info_row)

        layout.addLayout(text_box, 1)

        if tag.get("cf_tag"):
            cf_label = QLabel(tag["cf_tag"])
            cf_label.setObjectName("cfTag")
            layout.addWidget(cf_label, alignment=Qt.AlignmentFlag.AlignTop)

        # 无算法但有详情的思维模式：显示“展开”而不是无效的“模板”
        self.detail_btn = None
        if tag.get("detail"):
            self.detail_btn = QPushButton("展开")
            self.detail_btn.setObjectName("detailBtn")
            self.detail_btn.setFixedWidth(56)
            self.detail_btn.clicked.connect(self._toggle_detail)
            layout.addWidget(self.detail_btn, alignment=Qt.AlignmentFlag.AlignTop)

        # 有算法模板的条目：显示“模板”
        if tag.get("algorithms"):
            template_btn = QPushButton("模板")
            template_btn.setObjectName("detailBtn")
            template_btn.setFixedWidth(56)
            template_btn.clicked.connect(self._show_template)
            layout.addWidget(template_btn, alignment=Qt.AlignmentFlag.AlignTop)

        outer.addLayout(layout)

        # 可展开详情
        self.detail_box = None
        if tag.get("detail"):
            self.detail_box = QFrame()
            self.detail_box.setObjectName("tagDetail")
            detail_layout = QVBoxLayout(self.detail_box)
            detail_layout.setContentsMargins(10, 8, 10, 8)
            detail_layout.setSpacing(4)
            detail_text = QLabel(tag["detail"])
            detail_text.setObjectName("tagDetailText")
            detail_text.setTextFormat(Qt.TextFormat.PlainText)
            detail_text.setWordWrap(True)
            detail_text.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            detail_layout.addWidget(detail_text)
            self.detail_box.setVisible(False)
            outer.addWidget(self.detail_box)

        if self.checkbox.isChecked():
            self._apply_checked(True)

    def _changed(self, state):
        checked = state == Qt.CheckState.Checked.value
        self.store.set_mastered(self.tag["id"], checked)
        self._apply_checked(checked)
        self.on_change()

    def _apply_checked(self, checked: bool):
        self.setProperty("mastered", checked)
        self.style().unpolish(self)
        self.style().polish(self)

    def _toggle_detail(self):
        if self.detail_box is not None:
            self.set_detail_visible(not self._detail_open)

    def set_detail_visible(self, visible: bool):
        """统一控制详情展开/收起，并同步按钮文字。"""
        if self.detail_box is None:
            return
        self._detail_open = bool(visible)
        self.detail_box.setVisible(self._detail_open)
        if self.detail_btn is not None:
            self.detail_btn.setText("收起" if self._detail_open else "展开")

    def matches(self, text: str) -> bool:
        """搜索过滤：名称、描述、分组、详情正文、信息论标签均可匹配。"""
        if not text:
            return True
        haystack = " ".join([
            self.tag.get("name", ""),
            self.tag.get("desc", ""),
            self.tag.get("group", ""),
            self.tag.get("detail", ""),
            " ".join(self.tag.get("algorithms", [])),
            " ".join(self.tag_info.get("ops", [])),
            " ".join(self.tag_info.get("topologies", [])),
            " ".join(self.tag_info.get("dynamics", [])),
            " ".join(self.tag_info.get("metrics", [])),
        ]).lower()
        return text.lower() in haystack

    def matches_op(self, op: str) -> bool:
        """按信息操作过滤：不传 op 时全部通过。"""
        if not op:
            return True
        return op in self.info_ops

    def _show_template(self):
        names = self.tag.get("algorithms", [])
        algs = [ALGORITHM_BY_NAME[n] for n in names if n in ALGORITHM_BY_NAME]
        if not algs:
            QMessageBox.information(self, "暂无模板", "该知识点暂未关联具体模板。")
            return
        dialog = CodeDialog(self, algs, self.store.animation_level)
        dialog.exec()


class TierPage(QWidget):
    """单个档位的详情页。"""

    def __init__(self, tier, store, on_change):
        super().__init__()
        self.tier = tier
        self.store = store
        self.on_change = on_change
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 8, 10, 8)
        layout.setSpacing(6)

        # 极细进度条，尽量让内容区更大
        self.progress_bar = QProgressBar()
        self.progress_bar.setObjectName("tierProgress")
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(6)
        layout.addWidget(self.progress_bar)

        if self.tier.get("phase_name"):
            phase_label = QLabel(
                f"{self.tier['phase_name']} · {self.tier.get('range', '')} · {self.tier.get('goal', '')}"
            )
            phase_label.setObjectName("phaseLabel")
            phase_label.setWordWrap(True)
            layout.addWidget(phase_label)

        # 信息论操作过滤：跨档位看见同一把“刀”（仅有关联算法的档位显示）
        self.current_op_filter = ""
        self.op_filter_buttons = []
        if any(tag.get("algorithms") for tag in self.tier["tags"]):
            filter_layout = QHBoxLayout()
            filter_layout.setSpacing(4)
            all_btn = QPushButton("全部")
            all_btn.setObjectName("infoFilterBtn")
            all_btn.setCheckable(True)
            all_btn.setChecked(True)
            all_btn.clicked.connect(lambda checked=False: self._set_op_filter(""))
            filter_layout.addWidget(all_btn)
            self.op_filter_buttons.append(all_btn)
            for op in INFO_OPS:
                btn = QPushButton(op)
                btn.setObjectName("infoFilterBtn")
                btn.setProperty("op", op)
                btn.setCheckable(True)
                btn.clicked.connect(lambda checked=False, o=op: self._set_op_filter(o))
                filter_layout.addWidget(btn)
                self.op_filter_buttons.append(btn)
            filter_layout.addStretch(1)
            layout.addLayout(filter_layout)

        # 已删除搜索框；仅在第 8 档保留批量展开/收起小按钮
        if self.tier["tags"] and any(t.get("detail") for t in self.tier["tags"]):
            toolbar = QHBoxLayout()
            toolbar.setSpacing(6)
            toolbar.addStretch(1)
            expand_btn = QPushButton("全部展开")
            expand_btn.setObjectName("toolBtn")
            expand_btn.clicked.connect(lambda: self._set_all_details(True))
            toolbar.addWidget(expand_btn)
            collapse_btn = QPushButton("全部收起")
            collapse_btn.setObjectName("toolBtn")
            collapse_btn.clicked.connect(lambda: self._set_all_details(False))
            toolbar.addWidget(collapse_btn)
            layout.addLayout(toolbar)

        # 标签列表（第 8 档带分组标题）
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        content = QWidget()
        self.tags_layout = QVBoxLayout(content)
        self.tags_layout.setContentsMargins(0, 0, 0, 0)
        self.tags_layout.setSpacing(6)
        self.tag_rows = []
        self.group_headers = {}
        self.group_rows = {}
        self.group_expanded = {}
        self.ungrouped_rows = []
        for tag in self.tier["tags"]:
            group = tag.get("group")
            if group and group not in self.group_headers:
                header = QPushButton(group)
                header.setObjectName("groupHeader")
                header.setCursor(Qt.CursorShape.PointingHandCursor)
                header.setToolTip(f"点击展开 / 收起「{group}」")
                header.clicked.connect(lambda checked=False, g=group: self._toggle_group(g))
                self.tags_layout.addWidget(header)
                self.group_headers[group] = header
                self.group_rows[group] = []
                self.group_expanded[group] = False
            row = TagRow(tag, self.store, self.on_change)
            self.tag_rows.append(row)
            if group:
                self.group_rows[group].append(row)
                row.setVisible(False)  # 默认折叠分组，减少拥挤
            else:
                self.ungrouped_rows.append(row)
            self.tags_layout.addWidget(row)

        # 分组标题带数量与折叠箭头
        for group, header in self.group_headers.items():
            count = len(self.group_rows[group])
            header.setText(f"▸ {group}（{count}）")
        self.tags_layout.addStretch(1)
        scroll.setWidget(content)
        layout.addWidget(scroll, 1)

        self.update_progress()

    def _filter_tags(self, text: str):
        text = (text or "").strip()
        op = self.current_op_filter

        def row_visible(row) -> bool:
            if op and not row.matches_op(op):
                return False
            if text and not row.matches(text):
                return False
            return True

        for row in self.ungrouped_rows:
            row.setVisible(row_visible(row))
        for group, rows in self.group_rows.items():
            header = self.group_headers.get(group)
            if text or op:
                matched = [row for row in rows if row_visible(row)]
                for row in rows:
                    row.setVisible(False)
                for row in matched:
                    row.setVisible(True)
                if header is not None:
                    header.setVisible(bool(matched))
            else:
                expanded = self.group_expanded.get(group, False)
                for row in rows:
                    row.setVisible(expanded)
                if header is not None:
                    header.setVisible(True)

    def _set_op_filter(self, op: str):
        self.current_op_filter = op or ""
        for btn in self.op_filter_buttons:
            if btn.text() == "全部":
                btn.setChecked(not self.current_op_filter)
            else:
                btn.setChecked(btn.text() == self.current_op_filter)
        self._filter_tags("")

    def _toggle_group(self, group: str):
        if group not in self.group_expanded:
            return
        self.group_expanded[group] = not self.group_expanded[group]
        self._refresh_group_header(group)
        self._filter_tags("")

    def _refresh_group_header(self, group: str):
        header = self.group_headers.get(group)
        if header is None:
            return
        count = len(self.group_rows.get(group, []))
        arrow = "▾" if self.group_expanded.get(group, False) else "▸"
        header.setText(f"{arrow} {group}（{count}）")

    def _set_all_details(self, visible: bool):
        # 全部展开/收起同时控制分组展开状态与详情，避免“展开了但看不到”
        for row in self.tag_rows:
            if hasattr(row, "set_detail_visible"):
                row.set_detail_visible(visible)
        for group in self.group_headers:
            self.group_expanded[group] = visible
            self._refresh_group_header(group)
        self._filter_tags("")

    def update_progress(self):
        total = len(self.tier["tags"])
        done = sum(1 for t in self.tier["tags"] if self.store.is_mastered(t["id"]))
        self.progress_bar.setRange(0, total)
        self.progress_bar.setFormat(f"已掌握 {done} / {total}")
        self.progress_bar.setToolTip(f"已掌握 {done} / {total}")
        if hasattr(self, "_progress_anim"):
            self._progress_anim.stop()
        level = self.store.animation_level
        if level in (ANIM_OFF, ANIM_LIGHT):
            self.progress_bar.setValue(done)
            return
        self._progress_anim = QPropertyAnimation(self.progress_bar, b"value", self)
        self._progress_anim.setStartValue(self.progress_bar.value())
        self._progress_anim.setEndValue(done)
        self._progress_anim.setDuration(420)
        self._progress_anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._progress_anim.start()


def make_tier_icon(color_hex: str) -> QIcon:
    """生成一个 18x18 的档位色块图标。"""
    pm = QPixmap(18, 18)
    pm.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pm)
    painter.setPen(Qt.PenStyle.NoPen)
    painter.setBrush(QColor(color_hex))
    painter.drawRect(0, 0, 17, 17)
    painter.end()
    return QIcon(pm)


def tier_item_text(tier, store) -> str:
    # 极简侧栏：只保留档位数字，颜色即档位标识
    return str(tier["id"])


class InfoGuideDialog(QDialog):
    """信息论导论：四操作、四阶段、解剖四步、量纲速查。"""

    def __init__(self, parent=None, store=None):
        super().__init__(parent)
        self.store = store
        self.setWindowTitle("信息论导论 / 解剖四步")
        self.resize(860, 680)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)

        browser = QTextBrowser(self)
        browser.setObjectName("guideBrowser")
        browser.setOpenExternalLinks(False)
        browser.setHtml(self._build_html())
        layout.addWidget(browser, 1)

        close_btn = QPushButton("关闭")
        close_btn.setObjectName("closeBtn")
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn, alignment=Qt.AlignmentFlag.AlignRight)

    def _build_html(self) -> str:
        op_counts = {op: 0 for op in INFO_OPS}
        for alg in ALGORITHMS:
            for op in alg.get("info", {}).get("ops", []):
                if op in op_counts:
                    op_counts[op] += 1

        mastered_counts = None
        if self.store is not None:
            mastered_counts = {op: 0 for op in INFO_OPS}
            for tier in TIERS:
                for tag in tier["tags"]:
                    if not self.store.is_mastered(tag.get("id", "")):
                        continue
                    agg = aggregate_tag_info(tag)
                    for op in agg["ops"]:
                        if op in mastered_counts:
                            mastered_counts[op] += 1

        op_items = []
        for op in INFO_OPS:
            color = INFO_OP_COLORS.get(op, "#9AA1B0")
            desc = {
                OP_ENCODE: "减少冗余：哈希 / 前缀和 / 线性基 / SAM / 可持久化",
                OP_PROPAGATE: "扩散信息：BFS / DP / Dijkstra / 线段树 pushup / 树形 DP",
                OP_PRUNE: "缩小搜索：二分 / 双指针 / 单调栈 / 凸包 / 斜率优化 / 最小割",
                OP_TRANSFORM: "解耦纠缠：FFT / 矩阵幂 / 差分 / 对偶 / 生成函数 / LCT",
                OP_BASELINE: "没有信息破缺：暴力 / 模拟 / 几何原子 / 构造",
            }.get(op, "")
            mastered_cell = ""
            if mastered_counts is not None:
                mastered_cell = f'<td style="text-align:center;">{mastered_counts.get(op, 0)}</td>'
            op_items.append(
                f'<tr><td style="color:{color};font-weight:600;white-space:nowrap;">{op}</td>'
                f'<td>{desc}</td><td style="text-align:center;">{op_counts.get(op, 0)}</td>'
                f'{mastered_cell}</tr>'
            )

        phase_rows = []
        for pid in sorted(PHASES):
            ph = PHASES[pid]
            phase_rows.append(
                f"<tr><td style='font-weight:600;white-space:nowrap;'>{ph['name']}</td>"
                f"<td>{ph['range']}</td><td>{ph['slogan']}</td>"
                f"<td>{ph['description']}</td></tr>"
            )

        anatomy_rows = []
        for s in ANATOMY_STEPS:
            anatomy_rows.append(
                f"<tr><td style='font-weight:600;white-space:nowrap;'>{s['step']}</td>"
                f"<td>{s['question']}</td><td>{s['choices']}</td><td>{s['output']}</td></tr>"
            )

        return f"""
<html>
<body style="font-family:'Microsoft YaHei',sans-serif;font-size:13px;color:#eef0f4;background:#1d1f26;">
<h2 style="color:#82a0ff;">信息论视角：把 120 个算法压缩成一条认知轴</h2>
<p>算法不需要背标签。先问自己：<b>数据长在哪、变不变、按什么规则合并、n 有多大？</b></p>

<h3 style="color:#82a0ff;">一、四种信息操作 + 基线/暴力（算法世界的基本力）</h3>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
<tr><th>操作</th><th>代表算法</th><th>覆盖数</th>{("<th>已掌握</th>" if mastered_counts is not None else "")}</tr>
{''.join(op_items)}
</table>

<h3 style="color:#82a0ff;">二、四阶段难度地图</h3>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
<tr><th>阶段</th><th>约对应档位</th><th>一句话</th><th>核心战术</th></tr>
{''.join(phase_rows)}
</table>

<h3 style="color:#82a0ff;">三、解剖四步</h3>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
<tr><th>步骤</th><th>问题</th><th>选项</th><th>产出</th></tr>
{''.join(anatomy_rows)}
</table>

<h3 style="color:#82a0ff;">四、量纲速查（约束匕首）</h3>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
<tr><th>n</th><th>允许复杂度</th><th>常走的路</th></tr>
<tr><td>≤20</td><td>指数 / 状压</td><td>直接枚举子集、TSP、位运算</td></tr>
<tr><td>≤100</td><td>O(n³)</td><td>Floyd、区间 DP、矩阵乘法</td></tr>
<tr><td>≤5000</td><td>O(n²)</td><td>简单 DP、N² 枚举、局部剪枝</td></tr>
<tr><td>≤1e5</td><td>O(n log n)</td><td>排序 / 二分 / 堆 / 线段树 / 分治</td></tr>
<tr><td>≤1e9</td><td>对数 / 公式</td><td>数学公式、矩阵快速幂、找循环节</td></tr>
</table>

<p style="margin-top:14px;color:#9aa1b0;">
提醒：四种操作是<b>方便联想的记忆坐标系</b>，不是严格数学分类；一个算法常有多个标签。
例如树链剖分 = 编码压缩 + 传播松弛，AC 自动机 = 编码压缩 + 剪枝决策。
「已掌握」列按知识点行统计，一个标签包含多个操作时会重复计入。
</p>
</body>
</html>
"""


class ResizeHandle(QFrame):
    """无边框窗口的边缘/角落调整手柄。"""

    def __init__(self, parent, directions):
        super().__init__(parent)
        self.directions = set(directions)
        self._press_global = None
        self._start_geo = None
        self.setMouseTracking(True)
        self.setCursor(self._cursor())

    def _cursor(self):
        d = self.directions
        if "left" in d and "top" in d:
            return Qt.CursorShape.SizeFDiagCursor
        if "right" in d and "bottom" in d:
            return Qt.CursorShape.SizeFDiagCursor
        if "right" in d and "top" in d:
            return Qt.CursorShape.SizeBDiagCursor
        if "left" in d and "bottom" in d:
            return Qt.CursorShape.SizeBDiagCursor
        if "left" in d or "right" in d:
            return Qt.CursorShape.SizeHorCursor
        return Qt.CursorShape.SizeVerCursor

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._press_global = event.globalPosition().toPoint()
            self._start_geo = self.window().geometry()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._press_global is not None and event.buttons() & Qt.MouseButton.LeftButton:
            delta = event.globalPosition().toPoint() - self._press_global
            g = self._start_geo
            x, y, w, h = g.x(), g.y(), g.width(), g.height()
            d = self.directions
            if "left" in d:
                x += delta.x()
                w -= delta.x()
            if "right" in d:
                w += delta.x()
            if "top" in d:
                y += delta.y()
                h -= delta.y()
            if "bottom" in d:
                h += delta.y()
            min_w = self.window().minimumWidth()
            min_h = self.window().minimumHeight()
            if w < min_w:
                if "left" in d:
                    x -= min_w - w
                w = min_w
            if h < min_h:
                if "top" in d:
                    y -= min_h - h
                h = min_h
            self.window().setGeometry(x, y, w, h)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._press_global = None


class TitleBar(QFrame):
    """自定义标题栏：支持拖动窗口，左侧 macOS 风格按钮。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("titleBar")
        self.setFixedHeight(36)
        self._drag_pos = None

        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 0, 14, 0)
        layout.setSpacing(8)

        self.close_btn = QPushButton()
        self.close_btn.setObjectName("winClose")
        self.close_btn.setFixedSize(14, 14)
        self.close_btn.setToolTip("关闭")
        self.close_btn.setStyleSheet("QPushButton { background: #ff5f57; border: none; border-radius: 7px; } QPushButton:hover { background: #ff7b74; }")
        self.close_btn.clicked.connect(self.window().close)

        self.min_btn = QPushButton()
        self.min_btn.setObjectName("winMin")
        self.min_btn.setFixedSize(14, 14)
        self.min_btn.setToolTip("最小化")
        self.min_btn.setStyleSheet("QPushButton { background: #febc2e; border: none; border-radius: 7px; } QPushButton:hover { background: #ffce5c; }")
        self.min_btn.clicked.connect(self.window().showMinimized)

        self.max_btn = QPushButton()
        self.max_btn.setObjectName("winMax")
        self.max_btn.setFixedSize(14, 14)
        self.max_btn.setToolTip("最大化 / 还原")
        self.max_btn.setStyleSheet("QPushButton { background: #28c840; border: none; border-radius: 7px; } QPushButton:hover { background: #4cdb62; }")
        self.max_btn.clicked.connect(self._toggle_max)

        title = QLabel("")
        title.setObjectName("winTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title, 1)

        layout.addSpacing(8)
        layout.addWidget(self.close_btn)
        layout.addWidget(self.min_btn)
        layout.addWidget(self.max_btn)

    def _toggle_max(self):
        win = self.window()
        if win.isMaximized():
            win.showNormal()
        else:
            win.showMaximized()
        if hasattr(win, "_update_maximized_mode"):
            win._update_maximized_mode()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.window().frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_pos is not None and event.buttons() & Qt.MouseButton.LeftButton:
            self.window().move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._drag_pos = None


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(WINDOW_TITLE)
        self.setWindowIcon(make_tier_icon("#C79A6B"))
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.Window)
        self.resize(1080, 720)
        self.setMinimumSize(860, 560)

        self.store = ProgressStore()

        central = QWidget()
        central.setObjectName("appShell")
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        self.root_layout = root

        self.title_bar = TitleBar(self)
        root.addWidget(self.title_bar)

        body = QWidget()
        body.setObjectName("appBody")
        body_layout = QHBoxLayout(body)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(0)
        root.addWidget(body, 1)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)
        body_layout.addWidget(splitter)

        # 左侧档位列表：极简导航，只留颜色 + 数字
        left = QWidget()
        left.setObjectName("sidebar")
        left.setFixedWidth(88)
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(6, 6, 6, 6)
        left_layout.setSpacing(4)

        app_title = QLabel("CF 难度阶梯", left)
        app_title.setObjectName("appTitle")
        app_title.setVisible(False)

        self.global_progress = QLabel(left)
        self.global_progress.setObjectName("globalProgress")
        self.global_progress.setVisible(False)

        self.tier_list = QListWidget()
        self.tier_list.setObjectName("tierList")
        self.tier_list.setUniformItemSizes(True)
        self.tier_list.setIconSize(QSize(18, 18))
        self.tier_list.currentRowChanged.connect(self._on_tier_changed)
        left_layout.addWidget(self.tier_list, 1)

        # 信息论导论入口：常驻一个小按钮，不占太多空间
        self.info_btn = QPushButton("导论", left)
        self.info_btn.setObjectName("infoBtn")
        self.info_btn.setToolTip("打开信息论总纲：四操作 / 四阶段 / 解剖四步")
        self.info_btn.clicked.connect(self._show_guide)
        left_layout.addWidget(self.info_btn)

        # 简约模式：隐藏风格/动画/重置等次要控制，避免挤压左侧 8 档列表
        self.style_btn = QPushButton(left)
        self.style_btn.setObjectName("styleBtn")
        self.style_btn.clicked.connect(self._toggle_style)
        self.style_btn.setVisible(False)

        anim_label = QLabel("动画强度", left)
        anim_label.setObjectName("animLabel")
        anim_label.setVisible(False)

        self.anim_combo = QComboBox(left)
        self.anim_combo.setObjectName("animCombo")
        for level in (ANIM_OFF, ANIM_LIGHT, ANIM_SMOOTH):
            self.anim_combo.addItem(ANIM_NAMES[level], level)
        idx = self.anim_combo.findData(self.store.animation_level)
        self.anim_combo.setCurrentIndex(idx if idx >= 0 else 1)
        self.anim_combo.currentIndexChanged.connect(self._change_animation_level)
        self.anim_combo.setVisible(False)

        reset_btn = QPushButton("重置进度", left)
        reset_btn.setObjectName("resetBtn")
        reset_btn.clicked.connect(self._reset_progress)
        reset_btn.setVisible(False)

        splitter.addWidget(left)

        # 右侧内容
        self.right_container = QWidget()
        self.right_container.setObjectName("rightContainer")
        self.right_layout = QVBoxLayout(self.right_container)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(0)
        splitter.addWidget(self.right_container)

        splitter.setSizes([240, 840])

        self._install_resize_handles()
        self._update_window_effect()

        self._populate_tier_list()
        self._update_global_progress()
        self._apply_style(self.store.style_mode)
        self._update_maximized_mode()
        if self.tier_list.count() > 0:
            self.tier_list.setCurrentRow(0)

    def _install_resize_handles(self):
        central = self.centralWidget()
        self._resize_handles = []
        specs = [
            ("left", ["left"]),
            ("right", ["right"]),
            ("top", ["top"]),
            ("bottom", ["bottom"]),
            ("topleft", ["left", "top"]),
            ("topright", ["right", "top"]),
            ("bottomleft", ["left", "bottom"]),
            ("bottomright", ["right", "bottom"]),
        ]
        for name, dirs in specs:
            handle = ResizeHandle(central, dirs)
            handle.setObjectName(f"resizeHandle{name}")
            handle.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)
            self._resize_handles.append(handle)
        self._layout_resize_handles()

    def _layout_resize_handles(self):
        central = self.centralWidget()
        w = central.width()
        h = central.height()
        m = 0
        t = 6
        positions = {
            "left": (0, m, t, h - 2 * m),
            "right": (w - t, m, t, h - 2 * m),
            "top": (m, 0, w - 2 * m, t),
            "bottom": (m, h - t, w - 2 * m, t),
            "topleft": (0, 0, 14, 14),
            "topright": (w - 14, 0, 14, 14),
            "bottomleft": (0, h - 14, 14, 14),
            "bottomright": (w - 14, h - 14, 14, 14),
        }
        for handle in self._resize_handles:
            name = handle.objectName().replace("resizeHandle", "")
            x, y, rw, rh = positions[name]
            handle.setGeometry(x, y, rw, rh)
            handle.raise_()

    def _update_maximized_mode(self):
        """最大化时去掉外圈留白、圆角和阴影，让界面真正填满屏幕。"""
        if not hasattr(self, "root_layout") or not hasattr(self, "title_bar"):
            return
        maximized = self.isMaximized()

        shell = self.centralWidget()
        shell.setProperty("maximized", maximized)
        shell.style().unpolish(shell)
        shell.style().polish(shell)

        self.title_bar.setProperty("maximized", maximized)
        self.title_bar.style().unpolish(self.title_bar)
        self.title_bar.style().polish(self.title_bar)

        # 扁平化：任何状态下都不保留四周留白
        self.root_layout.setContentsMargins(0, 0, 0, 0)

        if hasattr(self, "_resize_handles"):
            for handle in self._resize_handles:
                handle.setVisible(not maximized)

        self._update_window_effect()
        self.root_layout.invalidate()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "_resize_handles"):
            self._layout_resize_handles()
        if hasattr(self, "root_layout") and hasattr(self, "title_bar"):
            self._update_maximized_mode()

    def _update_window_effect(self):
        # 扁平简约：不使用窗口阴影，避免四边出现多余暗角
        self.centralWidget().setGraphicsEffect(None)

    def _populate_tier_list(self):
        for tier in TIERS:
            item = QListWidgetItem()
            item.setText(tier_item_text(tier, self.store))
            item.setIcon(make_tier_icon(tier["color"]))
            item.setData(Qt.ItemDataRole.UserRole, tier["id"])
            item.setSizeHint(QSize(76, 44))
            total = len(tier["tags"])
            done = sum(1 for t in tier["tags"] if self.store.is_mastered(t["id"]))
            phase_line = tier.get("phase_name", "")
            item.setToolTip(f"{tier['name']}  {tier['range']}\n{phase_line}\n已掌握 {done}/{total}")
            self.tier_list.addItem(item)

    def _refresh_tier_list(self):
        for i, tier in enumerate(TIERS):
            item = self.tier_list.item(i)
            if item:
                item.setText(tier_item_text(tier, self.store))
                total = len(tier["tags"])
                done = sum(1 for t in tier["tags"] if self.store.is_mastered(t["id"]))
                phase_line = tier.get("phase_name", "")
                item.setToolTip(f"{tier['name']}  {tier['range']}\n{phase_line}\n已掌握 {done}/{total}")

    def _on_tier_changed(self, row: int):
        if row < 0 or row >= len(TIERS):
            return
        tier = TIERS[row]
        self._clear_right()
        page = TierPage(tier, self.store, self._update_global_progress)
        self.right_layout.addWidget(page, 1)

    def _clear_right(self):
        while self.right_layout.count():
            item = self.right_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def _update_global_progress(self):
        total = TOTAL_TAGS
        done = self.store.mastered_count()
        self.global_progress.setText(f"总进度：{done} / {total}")
        self._refresh_tier_list()
        # 刷新当前页进度条
        for i in range(self.right_layout.count()):
            w = self.right_layout.itemAt(i).widget()
            if isinstance(w, TierPage):
                w.update_progress()

    def _reset_progress(self):
        ret = QMessageBox.question(
            self,
            "确认重置",
            "确定要清空所有已掌握进度吗？",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if ret == QMessageBox.StandardButton.Yes:
            self.store.reset()
            self._update_global_progress()
            row = self.tier_list.currentRow()
            if row >= 0:
                self._on_tier_changed(row)

    def _apply_style(self, mode: str):
        if mode == STYLE_LIGHT:
            qss_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "style_mac.qss")
        else:
            qss_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.qss")
        QApplication.instance().setStyleSheet(load_qss(qss_path))
        self.style_btn.setText(f"风格：{STYLE_NAMES[mode]}")
        self.style_btn.setToolTip("点击切换 深色现代 / 浅色现代 风格")

    def _show_guide(self):
        dlg = InfoGuideDialog(self, self.store)
        dlg.exec()

    def _toggle_style(self):
        new_mode = STYLE_LIGHT if self.store.style_mode == STYLE_DARK else STYLE_DARK
        self.store.set_style_mode(new_mode)
        self._apply_style(new_mode)

    def _change_animation_level(self, index: int):
        level = self.anim_combo.itemData(index)
        self.store.set_animation_level(level)
        self._update_window_effect()
        # 立即刷新当前页进度条，关闭动画时直接跳到最终值
        for i in range(self.right_layout.count()):
            w = self.right_layout.itemAt(i).widget()
            if isinstance(w, TierPage):
                w.update_progress()


def main():
    QApplication.setOrganizationName(ORG_NAME)
    QApplication.setApplicationName(APP_NAME)
    app = QApplication(sys.argv)
    app.setStyleSheet(load_qss(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.qss")))
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
