import CodeEditor from "@/components/CodeEditor";
import ColorPicker from "@/components/ColorPicker";
import { updateSQL } from "@/database";
import { MainContext } from "@/pages/Main";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { detectMarkdown } from "@/utils/codeDetector";
import MDEditor from "@uiw/react-md-editor";
import { useBoolean } from "ahooks";
import { Form, Input, Modal, Select } from "antd";
import { find } from "lodash-es";
import { forwardRef, useContext, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EditModalRef {
	open: () => void;
}

interface FormFields {
	content: string;
}

// 支持的文本类型选项
const TEXT_TYPE_OPTIONS = [
	{ value: "text", label: "纯文本" },
	{ value: "html", label: "HTML" },
	{ value: "rtf", label: "富文本" },
	{ value: "markdown", label: "Markdown" },
	{ value: "code", label: "代码" },
	{ value: "color", label: "颜色" },
];

// 支持的代码语言选项
const CODE_LANGUAGE_OPTIONS = [
	{ value: "javascript", label: "JavaScript" },
	{ value: "typescript", label: "TypeScript" },
	{ value: "python", label: "Python" },
	{ value: "java", label: "Java" },
	{ value: "cpp", label: "C++" },
	{ value: "c", label: "C" },
	{ value: "csharp", label: "C#" },
	{ value: "rust", label: "Rust" },
	{ value: "go", label: "Go" },
	{ value: "php", label: "PHP" },
	{ value: "ruby", label: "Ruby" },
	{ value: "swift", label: "Swift" },
	{ value: "kotlin", label: "Kotlin" },
	{ value: "scala", label: "Scala" },
	{ value: "sql", label: "SQL" },
	{ value: "html", label: "HTML" },
	{ value: "css", label: "CSS" },
	{ value: "json", label: "JSON" },
	{ value: "xml", label: "XML" },
	{ value: "yaml", label: "YAML" },
	{ value: "bash", label: "Bash" },
	{ value: "shell", label: "Shell" },
	{ value: "powershell", label: "PowerShell" },
];

const EditModal = forwardRef<EditModalRef>((_, ref) => {
	const { t } = useTranslation();
	const { state } = useContext(MainContext);
	const [open, { toggle }] = useBoolean();
	const [item, setItem] = useState<HistoryTablePayload>();
	const [form] = Form.useForm<FormFields>();
	const [content, setContent] = useState<string>("");
	// 当前选择的文本类型
	const [selectedType, setSelectedType] = useState<string>("text");
	// 当前选择的代码语言（仅当类型为代码时使用）
	const [selectedCodeLanguage, setSelectedCodeLanguage] = useState<string>("");
	// 当前选择的颜色格式（仅当类型为颜色时使用）
	const [selectedColorFormat, setSelectedColorFormat] = useState<
		"hex" | "rgb" | "rgba"
	>("hex");

	// 获取剪贴板内容的可编辑形式
	const getEditableContent = (item: HistoryTablePayload): string => {
		if (!item) return "";

		const { type, value } = item;

		switch (type) {
			case "text":
				return value;
			case "html":
				// HTML类型直接返回原始HTML，让CodeEditor以HTML语法高亮显示
				return value;
			case "rtf":
				// 去除RTF标记获取纯文本进行编辑
				return value.replace(/\\[a-zA-Z]+\d*/g, "").replace(/[{}]/g, "");
			case "color":
				// 颜色类型直接返回颜色值
				return value;
			default:
				return value;
		}
	};

	// 初始化类型选择状态
	const initializeTypeSelection = (item: HistoryTablePayload) => {
		// 优先检查数据库中保存的类型
		if (item.type === "color") {
			// 如果是颜色类型
			setSelectedType("color");
			setSelectedCodeLanguage("");
			// 根据值判断颜色格式
			if (item.value.startsWith("rgba(")) {
				setSelectedColorFormat("rgba");
			} else if (item.value.startsWith("rgb(")) {
				setSelectedColorFormat("rgb");
			} else {
				setSelectedColorFormat("hex");
			}
		} else if (item.type === "markdown") {
			// 如果数据库中明确保存为markdown类型，直接使用Markdown编辑器
			setSelectedType("markdown");
			setSelectedCodeLanguage("");
		} else if (
			item.isCode &&
			item.codeLanguage &&
			item.codeLanguage !== "markdown"
		) {
			// 如果是代码类型且不是markdown，使用代码编辑器
			setSelectedType("code");
			setSelectedCodeLanguage(item.codeLanguage);
		} else if (
			(item.isCode === false && item.codeLanguage === "markdown") ||
			detectMarkdown(item.value)
		) {
			// 如果是旧版本的markdown格式或检测到Markdown格式，设置为Markdown类型
			setSelectedType("markdown");
			setSelectedCodeLanguage("");
		} else {
			// 其他情况使用保存的类型或默认为文本
			setSelectedType(item.type || "text");
			setSelectedCodeLanguage("");
		}
	};

	// 处理文本类型变化
	const handleTypeChange = (type: string) => {
		setSelectedType(type);
		// 如果不是代码类型，清空代码语言选择
		if (type !== "code") {
			setSelectedCodeLanguage("");
		}
		// 如果不是颜色类型，重置颜色格式
		if (type !== "color") {
			setSelectedColorFormat("hex");
		}
	};

	// 处理代码语言变化
	const handleCodeLanguageChange = (language: string) => {
		setSelectedCodeLanguage(language);
	};

	// 判断是否使用代码编辑器
	const shouldUseCodeEditor = () => {
		return selectedType === "code" && selectedCodeLanguage;
	};

	// 判断是否使用Markdown编辑器
	const shouldUseMarkdownEditor = () => {
		return selectedType === "markdown";
	};

	// 判断是否使用颜色选择器
	const shouldUseColorPicker = () => {
		return selectedType === "color";
	};

	// 获取当前代码语言
	const getCurrentCodeLanguage = () => {
		if (selectedType === "code" && selectedCodeLanguage) {
			return selectedCodeLanguage;
		}
		if (item?.type === "html") {
			return "html";
		}
		return undefined;
	};

	useImperativeHandle(ref, () => ({
		open: () => {
			const findItem = find(state.list, { id: state.activeId });

			if (findItem) {
				const editableContent = getEditableContent(findItem);

				setContent(editableContent);
				form.setFieldsValue({
					content: editableContent,
				});

				setItem(findItem);
				// 初始化类型选择
				initializeTypeSelection(findItem);
			}

			toggle();
		},
	}));

	const handleOk = async () => {
		if (item && content) {
			const { id, favorite } = item;

			// 使用统一的时间戳
			const currentTime = Date.now();

			// 根据用户选择的类型更新项目属性
			let updateType: "text" | "html" | "rtf" | "markdown" | "color";
			let updateIsCode: boolean;
			let updateCodeLanguage: string;

			if (selectedType === "code") {
				updateType = "text"; // 代码在数据库中存储为text类型
				updateIsCode = true;
				updateCodeLanguage = selectedCodeLanguage;
			} else if (selectedType === "markdown") {
				updateType = "markdown"; // Markdown直接存储为markdown类型
				updateIsCode = false;
				updateCodeLanguage = "";
			} else if (selectedType === "color") {
				updateType = "color"; // 颜色存储为color类型
				updateIsCode = false;
				updateCodeLanguage = "";
			} else {
				// 确保类型是有效的ClipboardPayload类型
				updateType = selectedType as "text" | "html" | "rtf";
				updateIsCode = false;
				updateCodeLanguage = "";
			}

			// 更新本地数据
			item.type = updateType;
			item.isCode = updateIsCode;
			item.codeLanguage = updateCodeLanguage;
			item.value = content;
			item.lastModified = currentTime;
			// 重置同步状态为'none'，表示需要同步
			item.syncStatus = "none";

			// 更新数据库，包含新的内容、类型、时间戳和同步状态
			await updateSQL("history", {
				id,
				value: content,
				type: updateType,
				isCode: updateIsCode,
				codeLanguage: updateCodeLanguage,
				lastModified: currentTime,
				syncStatus: "none",
			});

			// 如果自动收藏功能开启，更新收藏状态，同时保持同步状态为'none'
			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				await updateSQL("history", {
					id,
					favorite: 1,
					lastModified: currentTime,
					syncStatus: "none",
				} as any);
			}
		}

		toggle();
	};

	return (
		<Modal
			forceRender
			centered
			title={t("component.edit_modal.label.edit")}
			open={open}
			onOk={handleOk}
			onCancel={toggle}
			width={900}
		>
			<Form form={form} initialValues={{ content }} onFinish={handleOk}>
				{/* 类型选择区域 */}
				<Form.Item className="mb-4">
					<div className="flex gap-2">
						<Select
							value={selectedType}
							onChange={handleTypeChange}
							style={{ width: 120 }}
							options={TEXT_TYPE_OPTIONS}
						/>
						{selectedType === "code" && (
							<Select
								value={selectedCodeLanguage}
								onChange={handleCodeLanguageChange}
								style={{ width: 150 }}
								placeholder="选择代码语言"
								options={CODE_LANGUAGE_OPTIONS}
							/>
						)}
					</div>
				</Form.Item>

				{/* 内容编辑区域 */}
				<Form.Item className="mb-0!">
					{shouldUseCodeEditor() ? (
						<div
							className="overflow-hidden rounded border"
							style={{ borderColor: "#424242" }}
						>
							<CodeEditor
								value={content}
								codeLanguage={getCurrentCodeLanguage()}
								onChange={(value) => {
									const newContent = value || "";
									setContent(newContent);
									form.setFieldsValue({ content: newContent });
								}}
								editable={true}
							/>
						</div>
					) : shouldUseMarkdownEditor() ? (
						<div
							className="overflow-hidden rounded border"
							style={{ borderColor: "#424242" }}
						>
							<MDEditor
								value={content}
								onChange={(value?: string) => {
									const newContent = value || "";
									setContent(newContent);
									form.setFieldsValue({ content: newContent });
								}}
								height={400}
								preview="edit"
							/>
						</div>
					) : shouldUseColorPicker() ? (
						<div
							className="overflow-hidden rounded border p-4"
							style={{ borderColor: "#424242" }}
						>
							<ColorPicker
								value={content}
								format={selectedColorFormat}
								onChange={(value) => {
									setContent(value);
									form.setFieldsValue({ content: value });
								}}
							/>
						</div>
					) : (
						<Input.TextArea
							value={content}
							onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
								const newContent = e.target.value;
								setContent(newContent);
								form.setFieldsValue({ content: newContent });
							}}
							autoComplete="off"
							placeholder={t("component.edit_modal.hints.input_content")}
							rows={12}
						/>
					)}
				</Form.Item>
			</Form>
		</Modal>
	);
});

export default EditModal;
