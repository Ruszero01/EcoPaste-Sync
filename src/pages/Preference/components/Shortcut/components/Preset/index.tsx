import { getKeySymbol } from "@/components/ProShortcut/keyboard";
import { Card, Flex, Tag } from "antd";
import { castArray, union } from "lodash-es";

const Preset = () => {
	const { t } = useTranslation();

	const list = [
		{
			label: "preference.shortcut.preset.search",
			value: PRESET_SHORTCUT.SEARCH,
		},
		{
			label: "preference.shortcut.preset.select_item",
			value: ["uparrow", "downarrow"],
		},
		{
			label: "preference.shortcut.preset.select_group",
			value: ["tab", "shift.tab"],
		},
		{
			label: "preference.shortcut.preset.paste",
			value: "enter",
		},
		{
			label: "preference.shortcut.preset.delete",
			value: ["delete", "backspace"],
		},
		{
			label: "preference.shortcut.preset.favorite",
			value: PRESET_SHORTCUT.FAVORITE,
		},
		{
			label: "preference.shortcut.preset.preview_image",
			value: "space",
		},
		{
			label: "preference.shortcut.preset.back_to_top",
			value: "Home",
		},
		{
			label: "preference.shortcut.preset.fixed_window",
			value: PRESET_SHORTCUT.FIXED_WINDOW,
		},
		{
			label: "preference.shortcut.preset.hide_window",
			value: ["esc", PRESET_SHORTCUT.HIDE_WINDOW],
		},
	].map(({ label, value }) => ({
		label,
		value: union(
			castArray(value).map((item) => {
				return item.split(".").map(getKeySymbol).join(" + ");
			}),
		),
	}));

	return (
		<div className="grid grid-cols-2 gap-2">
			{list.map((item) => {
				const { label, value } = item;

				return (
					<Card key={label} size="small">
						<Flex justify="space-between" align="center" className="h-[22px]">
							<span className="line-clamp-1 break-all">{t(label)}</span>

							<Flex wrap gap="small">
								{value.map((v) => (
									<Tag key={v} className="m-0">
										{v}
									</Tag>
								))}
							</Flex>
						</Flex>
					</Card>
				);
			})}
		</div>
	);
};

export default Preset;
