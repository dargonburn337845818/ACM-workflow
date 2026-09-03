# -*- coding: utf-8 -*-
"""Wallpaper Engine 高清导出工具（NVENC，无需 OBS）

支持两种用法：
1. 命令行：
   WallpaperExport.exe --wallpaper "...\\project.json" --width 1920 --height 1080 --seconds 15
2. 无参数 / 带 --gui：打开图形界面，选择壁纸后点导出
"""
import argparse
import os
import subprocess
import sys
import time


def find_we_exe():
    candidates = [
        r"C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper32.exe",
        r"C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe",
        r"C:\Program Files\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe",
        r"D:\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe",
        r"D:\steam\steamapps\common\wallpaper_engine\wallpaper64.exe",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    for exe in ("wallpaper64.exe", "wallpaper32.exe"):
        path = subprocess.run(["where", exe], capture_output=True, text=True)
        if path.returncode == 0 and path.stdout.strip():
            return path.stdout.strip().splitlines()[0]
    return None


def get_screen_size():
    try:
        import ctypes
        user32 = ctypes.windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    except Exception:
        return 1920, 1080


def force_window_top(window_name):
    """强制 Windows 窗口置顶并置前，避免录制时被其他窗口遮挡。"""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, window_name)
        if not hwnd:
            print(f"未找到窗口：{window_name}")
            return None
        SW_RESTORE = 9
        HWND_TOPMOST = -1
        SWP_NOMOVE = 0x0001
        SWP_NOSIZE = 0x0002
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
        print(f"已将窗口置顶：{window_name}")
        return hwnd
    except Exception:
        return None


def run_we(we_exe, args, check=True):
    cmd = [we_exe, "-control"] + args
    print(">>", " ".join(f'"{x}"' if " " in x else x for x in cmd))
    if check:
        subprocess.run(cmd, check=True)
    else:
        subprocess.run(cmd)


def export_wallpaper(wallpaper, width=1920, height=1080, seconds=15,
                     framerate=60, output=r"D:\wallpaper-vedio\wallpaper_hd.mp4",
                     window_name="WE_HD_Export", upscale=None):
    we_exe = find_we_exe()
    if not we_exe:
        raise RuntimeError("找不到 wallpaper32.exe / wallpaper64.exe，请确认 Wallpaper Engine 已安装")
    if not os.path.isfile(wallpaper):
        raise FileNotFoundError(f"壁纸文件不存在：{wallpaper}")

    if width <= 0 or height <= 0:
        width, height = get_screen_size()
        print(f"使用全屏分辨率：{width}x{height}")

    out_dir = os.path.dirname(os.path.abspath(output))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    run_we(we_exe, [
        "openWallpaper",
        "-file", wallpaper,
        "-playInWindow", window_name,
        "-width", str(width),
        "-height", str(height),
        "-x", "0", "-y", "0",
        "-activate",
        "-borderless",
    ], check=False)

    print("等待 Wallpaper Engine 渲染 3 秒…")
    time.sleep(3)

    # 强制 WE 渲染窗口置顶，避免被其他窗口挡住
    force_window_top(window_name)

    # 只截取 WE 窗口本身，不再录制整个桌面后裁剪
    filter_parts = []
    if upscale:
        uw, uh = upscale.lower().split("x")
        filter_parts.append(f"scale={uw}:{uh}:flags=lanczos")
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "gdigrab",
        "-framerate", str(framerate),
        "-i", "title=" + window_name,
        "-draw_mouse", "0",
        "-c:v", "h264_nvenc",
        "-preset", "p5",
        "-t", str(seconds),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
    ]
    if filter_parts:
        ffmpeg_cmd += ["-vf", ",".join(filter_parts)]
    ffmpeg_cmd.append(output)
    print(">>", " ".join(ffmpeg_cmd))
    try:
        subprocess.run(ffmpeg_cmd, check=True)
    except FileNotFoundError:
        run_we(we_exe, ["closeWallpaper", "-location", window_name], check=False)
        raise RuntimeError("未找到 ffmpeg，请安装带 NVENC 的 ffmpeg 并加入 PATH")
    except subprocess.CalledProcessError as e:
        run_we(we_exe, ["closeWallpaper", "-location", window_name], check=False)
        raise RuntimeError(f"ffmpeg 录制失败：{e}")

    run_we(we_exe, ["closeWallpaper", "-location", window_name], check=False)
    return output


def run_gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Wallpaper Engine 高清导出 (NVENC)")
    root.geometry("640x520")
    root.resizable(False, False)

    sw, sh = get_screen_size()

    wallpaper_var = tk.StringVar()
    width_var = tk.StringVar(value=str(sw))
    height_var = tk.StringVar(value=str(sh))
    seconds_var = tk.StringVar(value="15")
    upscale_var = tk.StringVar(value="")
    output_var = tk.StringVar(value=r"D:\wallpaper-vedio\wallpaper_hd.mp4")

    # 顶部引导
    ttk.Label(
        root,
        text="使用步骤：\n1. 选择 Wallpaper Engine 壁纸\n2. 设置分辨率 / 时长（默认全屏）\n3. 可选输出放大尺寸\n4. 点击「开始导出」",
        justify="left",
    ).pack(anchor="w", padx=18, pady=(16, 8))

    # 壁纸文件
    ttk.Label(root, text="壁纸文件 (project.json / scene.pkg / 视频):").pack(anchor="w", padx=18, pady=(6, 3))
    row = tk.Frame(root)
    row.pack(fill="x", padx=18)
    tk.Entry(row, textvariable=wallpaper_var, font=("Segoe UI", 10)).pack(side="left", fill="x", expand=True)
    tk.Button(row, text="浏览", command=lambda: browse_wallpaper(), width=8).pack(side="left", padx=6)

    # 参数区
    form = tk.Frame(root)
    form.pack(fill="x", padx=18, pady=10)
    tk.Label(form, text="宽").grid(row=0, column=0, padx=4, pady=4, sticky="e")
    tk.Entry(form, textvariable=width_var, width=12).grid(row=0, column=1, padx=4, pady=4)
    tk.Label(form, text="高").grid(row=0, column=2, padx=4, pady=4, sticky="e")
    tk.Entry(form, textvariable=height_var, width=12).grid(row=0, column=3, padx=4, pady=4)
    tk.Label(form, text="秒").grid(row=0, column=4, padx=4, pady=4, sticky="e")
    tk.Entry(form, textvariable=seconds_var, width=8).grid(row=0, column=5, padx=4, pady=4)

    # 放大尺寸
    ttk.Label(root, text="输出放大尺寸（留空=原始，例 3840x2160 / 7680x4320）").pack(anchor="w", padx=18, pady=(4, 2))
    tk.Entry(root, textvariable=upscale_var, font=("Segoe UI", 10)).pack(fill="x", padx=18)

    # 输出目录
    ttk.Label(root, text="输出目录：D:\\wallpaper-vedio").pack(anchor="w", padx=18, pady=(12, 2))
    tk.Entry(root, textvariable=output_var, font=("Segoe UI", 10)).pack(fill="x", padx=18)

    status = ttk.Label(root, text="", foreground="#666", wraplength=580)
    status.pack(fill="x", padx=18, pady=10)

    def browse_wallpaper():
        path = filedialog.askopenfilename(
            title="选择 Wallpaper Engine 壁纸",
            filetypes=[("Wallpaper", "*.json *.pkg *.mp4 *.webm *.mov"), ("所有文件", "*.*")]
        )
        if path:
            wallpaper_var.set(path)

    def do_export():
        wallpaper = wallpaper_var.get().strip()
        if not wallpaper:
            messagebox.showwarning("提示", "请先选择壁纸文件")
            return
        try:
            width = int(width_var.get() or 0)
            height = int(height_var.get() or 0)
            seconds = int(seconds_var.get() or 15)
        except ValueError:
            messagebox.showerror("错误", "宽/高/秒数必须是数字")
            return
        status.config(text="导出中…请稍候")
        root.update()
        try:
            out = export_wallpaper(
                wallpaper, width, height, seconds,
                output=output_var.get(),
                upscale=upscale_var.get().strip() or None,
            )
            status.config(text=f"完成：{out}")
            messagebox.showinfo("完成", f"已导出：\n{out}")
        except Exception as e:
            status.config(text=f"失败：{e}")
            messagebox.showerror("失败", str(e))

    def open_output_dir():
        try:
            os.startfile(r"D:\\wallpaper-vedio")
        except Exception:
            messagebox.showinfo("输出目录", r"D:\wallpaper-vedio")

    # 底部按钮，固定可见
    bottom = tk.Frame(root)
    bottom.pack(side="bottom", fill="x", pady=(0, 16), padx=18)
    export_btn = tk.Button(
        bottom, text="开始导出", command=do_export,
        bg="#3B5BDB", fg="white", font=("Segoe UI", 13, "bold"),
        padx=28, pady=8,
    )
    export_btn.pack(side="left", padx=4)
    tk.Button(bottom, text="打开输出目录", command=open_output_dir, width=14).pack(side="left", padx=6)
    tk.Button(bottom, text="关闭", command=root.destroy, width=8).pack(side="right", padx=4)

    root.mainloop()


def main():
    if len(sys.argv) == 1 or "--gui" in sys.argv:
        run_gui()
        return

    ap = argparse.ArgumentParser(description="Wallpaper Engine 高清导出（NVENC）")
    ap.add_argument("--wallpaper", required=True, help="Wallpaper 的 project.json / scene.pkg / 视频路径")
    ap.add_argument("--width", type=int, default=0, help="0 表示自动使用当前屏幕全屏分辨率")
    ap.add_argument("--height", type=int, default=0)
    ap.add_argument("--seconds", type=int, default=15)
    ap.add_argument("--framerate", type=int, default=60)
    ap.add_argument("--output", default=r"D:\wallpaper-vedio\wallpaper_hd.mp4")
    ap.add_argument("--window-name", default="WE_HD_Export")
    ap.add_argument("--upscale", default=None, help="输出放大尺寸，如 3840x2160 / 7680x4320")
    args = ap.parse_args()

    try:
        out = export_wallpaper(args.wallpaper, args.width, args.height, args.seconds,
                               args.framerate, args.output, args.window_name, args.upscale)
        print(f"完成：{out}")
    except Exception as e:
        print(f"错误：{e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
