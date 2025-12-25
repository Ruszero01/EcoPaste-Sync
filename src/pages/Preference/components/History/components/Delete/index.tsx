import AdaptiveSelect from "@/components/AdaptiveSelect";
import { DeleteOutlined } from "@ant-design/icons";
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
			const { timeRange, customRange, deleteFavorite } = form.getFieldsValue();

			setTrue();

			// TODO: 临时禁用，等待重构完成后实现
			// 功能正在重构中，将使用后端数据库命令
			message.warning("历史记录清理功能正在重构中，敬请期待");

			toggle();
		} catch (error) {
			message.error(String(error));
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
