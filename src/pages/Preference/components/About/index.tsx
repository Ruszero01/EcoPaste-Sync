import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { Avatar } from "antd";
import { useSnapshot } from "valtio";
import Thank from "./components/Thank";

const About = () => {
	const { env } = useSnapshot(globalStore);
	const { t } = useTranslation();

	return (
		<>
			<ProList header={t("preference.about.about_software.title")}>
				<ProListItem
					avatar={<Avatar src="/logo.png" size={44} shape="square" />}
					title={env.appName}
					description={`${t("preference.about.about_software.label.version")}v${env.appVersion}`}
				/>
			</ProList>

			<Thank />
		</>
	);
};

export default About;
