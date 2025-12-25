import CodeEditor from "@/components/CodeEditor";
import ColorPicker from "@/components/ColorPicker";
import { LISTEN_KEY } from "@/constants";
import { MainContext } from "@/pages/Main";
import { backendUpdateField } from "@/plugins/database";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { emit } from "@tauri-apps/api/event";
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
		"hex" | "rgb" | "cmyk"
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

	// 初始化类型选择
	const initializeTypeSelection = (item: HistoryTablePayload) => {
		if (!item) return;

		// 如果是代码类型，设置对应的选项
		if (item.isCode && item.codeLanguage) {
			setSelectedType("code");
			setSelectedCodeLanguage(item.codeLanguage);
		} else if (item.type === "markdown") {
			setSelectedType("markdown");
			setSelectedCodeLanguage("");
		} else if (item.type === "color") {
			setSelectedType("color");
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
		const { content: formContent } = form.getFieldsValue();

		if (item) {
			const { id, favorite } = item;
			const currentTime = Date.now();

			// 设置默认值
			let updateType = item.type;
			let updateIsCode = item.isCode || false;
			let updateCodeLanguage = item.codeLanguage || "";
			let updateSubtype: string | undefined = item.subtype;

			// 根据选择的类型更新对应的值
			if (selectedType === "code") {
				updateType = "text"; // 代码在数据库中存储为text类型
				updateIsCode = true;
				updateCodeLanguage = selectedCodeLanguage;
				updateSubtype = undefined; // 代码类型不需要subtype
			} else if (selectedType === "markdown") {
				updateType = "markdown"; // Markdown直接存储为markdown类型
				updateIsCode = false;
				updateCodeLanguage = "";
				updateSubtype = undefined; // Markdown类型不需要subtype
			} else if (selectedType === "color") {
				updateType = "color"; // 颜色存储为color类型
				updateIsCode = false;
				updateCodeLanguage = "";
				updateSubtype = undefined; // 颜色类型不再需要设置subtype
			} else {
				// 确保类型是有效的ClipboardPayload类型
				updateType = selectedType as "text" | "html" | "rtf";
				updateIsCode = false;
				updateCodeLanguage = "";
				updateSubtype = undefined; // 其他文本类型不需要subtype
			}

			// 保存原始值用于比较（避免被提前修改）
			const originalValue = item.value;
			const originalType = item.type;
			const originalSubtype = item.subtype;
			const originalIsCode = item.isCode;
			const originalCodeLanguage = item.codeLanguage;

			// 更新本地数据
			item.type = updateType;
			item.isCode = updateIsCode;
			item.codeLanguage = updateCodeLanguage;
			// 当类型改变时，清除subtype以避免渲染问题
			item.subtype = updateType === "color" ? undefined : updateSubtype;
			item.value = formContent;
			item.time = currentTime;
			// 注意：不设置syncStatus，让后端变更跟踪器处理

			// 立即更新本地状态中的对应项，确保前端显示立即更新
			const itemIndex = state.list.findIndex(
				(listItem) => listItem.id === item.id,
			);
			if (itemIndex !== -1) {
				// 创建一个新的对象引用，确保React能够检测到变化
				state.list[itemIndex] = { ...item };
			}

			// 调用database插件更新数据库
			// 1. 更新内容
			if (originalValue !== formContent) {
				await backendUpdateField(id, "content", formContent);
			}

			// 2. 更新类型和子类型
			if (originalType !== updateType) {
				await backendUpdateField(id, "type", updateType);
			}
			// 只有当 updateSubtype 有值时才更新
			if (updateSubtype !== undefined && originalSubtype !== updateSubtype) {
				await backendUpdateField(id, "subtype", updateSubtype);
			}

			// 3. 更新代码相关字段
			if (originalIsCode !== updateIsCode) {
				await backendUpdateField(id, "isCode", updateIsCode.toString());
			}
			if (originalCodeLanguage !== updateCodeLanguage) {
				await backendUpdateField(id, "codeLanguage", updateCodeLanguage || "");
			}

			// 如果自动收藏功能开启，更新收藏状态
			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				// 调用database插件更新收藏状态
				await backendUpdateField(id, "favorite", "true");
			}

			// 触发列表刷新事件，确保前端显示与数据库中的类型保持一致
			try {
				await emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (error) {
				console.error("触发列表刷新事件失败:", error);
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
								options={CODE_LANGUAGE_OPTIONS}
								placeholder="选择语言"
							/>
						)}
					</div>
				</Form.Item>

				{/* 编辑器区域 */}
				<Form.Item name="content" className="mb-0!">
					{shouldUseCodeEditor() ? (
						<CodeEditor
							value={content}
							onChange={setContent}
							language={getCurrentCodeLanguage()}
						/>
					) : shouldUseMarkdownEditor() ? (
						<div data-color-mode="light">
							<MDEditor
								value={content}
								onChange={(val) => setContent(val || "")}
							/>
						</div>
					) : shouldUseColorPicker() ? (
						<ColorPicker
							color={content}
							onChange={setContent}
							format={selectedColorFormat}
						/>
					) : (
						<Input.TextArea
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder={t("component.edit_modal.hints.input_content")}
							autoSize={{ minRows: 10, maxRows: 20 }}
						/>
					)}
				</Form.Item>
			</Form>
		</Modal>
	);
});

export default EditModal;
