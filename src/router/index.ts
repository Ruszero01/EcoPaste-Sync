import Main from "@/pages/Main";
import Preference from "@/pages/Preference";
import Preview from "@/pages/Preview";
import { createHashRouter } from "react-router-dom";

export const router = createHashRouter([
	{
		path: "/",
		Component: Main,
	},
	{
		path: "/preference",
		Component: Preference,
	},
	{
		path: "/preview",
		Component: Preview,
	},
]);
