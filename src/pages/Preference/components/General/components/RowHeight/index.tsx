import ProSelect from "@/components/ProSelect";
import { useSnapshot } from "valtio";

interface Option {
	label: string;
	value: number;
}

const RowHeight = () => {
	const { appearance } = useSnapshot(globalStore);
	const { t } = useTranslation();

	const options: Option[] = [
		{
			label: t("preference.settings.appearance_settings.label.row_height_high"),
			value: 116,
		},
		{
			label: t(
				"preference.settings.appearance_settings.label.row_height_medium",
			),
			value: 90,
		},
		{
			label: t("preference.settings.appearance_settings.label.row_height_low"),
			value: 62,
		},
	];

	return (
		<ProSelect
			title={t("preference.settings.appearance_settings.label.row_height")}
			value={appearance.rowHeight}
			options={options}
			onChange={(value) => {
				globalStore.appearance.rowHeight = value;
			}}
		/>
	);
};

export default RowHeight;
