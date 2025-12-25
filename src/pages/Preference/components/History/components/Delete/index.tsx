import AdaptiveSelect from "@/components/AdaptiveSelect";
import { DeleteOutlined } from "@ant-design/icons";
import { backendCleanupHistory, type CleanupRule } from "@/plugins/database";
import {
	Button,
	Checkbox,
	DatePicker,
	Drawer,
	Form,
	Space,
	message,
} from "antd";
import type { DefaultOptionType } from "antd/es/select";
import type { Dayjs } from "dayjs";

const { RangePicker } = DatePicker;

interface FormFields {
	timeRange: number;
	customRange: Dayjs[];
	deleteFavorite: boolean;
}

const Delete = () => {
	const [open, { toggle }] = useBoolean();
	const [form] = Form.useForm<FormFields>();
	const timeRange = Form.useWatch("timeRange", form);
	const [deleting, { setTrue, setFalse }] = useBoolean();

	const { t } = useTranslation();

	useEffect(form.resetFields, [open]);

	const rangeOptions: DefaultOptionType[] = [
		{
			label: t("preference.history.history.label.time_range_opt.last_hour"),
			value: 1,
		},
		{
			label: t("preference.history.history.label.time_range_opt.last_24_hours"),
			value: 24,
		},
		{
			label: t("preference.history.history.label.time_range_opt.last_7_days"),
			value: 7 * 24,
		},
		{
			label: t("preference.history.history.label.time_range_opt.last_30_days"),
			value: 30 * 24,
		},
		{
			label: t("preference.history.history.label.time_range_opt.unlimited"),
			value: 0,
		},
		{
			label: t("preference.history.history.label.time_range_opt.custom"),
			value: -1,
		},
	];

	const onSubmit = async () => {
		try {
			const { timeRange: formTimeRange } = form.getFieldsValue();

			setTrue();

			// 根据时间范围转换为保留天数
			// timeRange 是小时数，转为天数
			let retainDays = 0;
			if (formTimeRange > 0) {
				retainDays = Math.ceil(formTimeRange / 24);
			}

			// 调用后端清理
			const rule: CleanupRule = {
				retain_days: retainDays,
				retain_count: 0, // 手动清理不限制条数
			};

			await backendCleanupHistory(rule);

			message.success("历史记录清理完成");
			toggle();
		} catch (error) {
			message.error(
				`清理失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		} finally {
			setFalse();
		}
	};

	return (
		<>
			<Button block danger icon={<DeleteOutlined />} onClick={toggle}>
				{t("preference.history.history.button.goto_delete")}
			</Button>

			<Drawer
				open={open}
				title={t("preference.history.history.label.delete_title")}
				width="100%"
				closable={false}
				classNames={{
					body: "py-4!",
					footer: "flex justify-end",
				}}
				footer={
					<Space>
						<Button disabled={deleting} onClick={toggle}>
							{t("preference.history.history.button.cancel_delete")}
						</Button>

						<Button type="primary" loading={deleting} onClick={onSubmit}>
							{t("preference.history.history.button.confirm_delete")}
						</Button>
					</Space>
				}
			>
				<Form
					form={form}
					initialValues={{
						timeRange: rangeOptions[0].value,
						customRange: [dayjs().subtract(1, "hour"), dayjs()],
					}}
				>
					<Space>
						<Form.Item
							name="timeRange"
							label={t("preference.history.history.label.time_range")}
						>
							<AdaptiveSelect options={rangeOptions} />
						</Form.Item>

						{timeRange < 0 && (
							<Form.Item name="customRange">
								<RangePicker
									showTime
									disabledDate={(current) => current > dayjs().endOf("day")}
								/>
							</Form.Item>
						)}
					</Space>

					<Form.Item name="deleteFavorite" valuePropName="checked">
						<Checkbox>
							{t("preference.history.history.label.include_favorite")}
						</Checkbox>
					</Form.Item>
				</Form>
			</Drawer>
		</>
	);
};

export default Delete;
