from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import release_instance as instances


APP = "escrow"
COMMIT = "a" * 40


def save(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return path


def artifact(root, name, schema, **fields):
    if schema == "cam.bundle.v1":
        fields["authoringSourceCommit"] = COMMIT
    return save(root, name, {"schema": schema, "app": APP, "sourceCommit": COMMIT, "chainId": 43113, **fields})


def first_choice(label, choices, **_options):
    if not choices:
        raise ValueError(label)
    return choices[0][1]


class ReleaseInstanceTest(unittest.TestCase):
    def fixture(self, root):
        save(root, "config.json", {"app": APP})
        return artifact(root, "deployments/original/artifact/deployment.json", "escrow.deployment.v2")

    def test_full_deployment_allocates_its_own_private_records_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            save(root, "config.json", {"app": APP})
            selection, request, action = instances.prepare(root, APP, "deploy")
            self.assertEqual(0o700, action.stat().st_mode & 0o777)
            self.assertEqual(action.relative_to(root).as_posix(), instances.load_selection(root)["pending"])
            self.assertEqual(request, instances.read_json(action / "selection.json"))
            self.assertEqual({"config", "pending"}, set(selection))
            self.assertIn(f"OUTPUT_DIR={action}", instances.arguments(root, APP, request, action, str(root)))

    def test_ui_update_selects_recorded_business_not_a_newer_standalone_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            business = self.fixture(root)
            digest = "0x" + hashlib.sha256(business.read_bytes()).hexdigest()
            publication = artifact(root, "updates/previous/cam/artifact/cam-publication.json", "cam.publication.v1", businessArtifactSha256=digest)
            artifact(root, "deployments/newer/contracts/artifact/contract-deployment.json", "cam.contract-deployment.v1", sourceCommit="b" * 40)
            records = instances.inventory(root, APP)
            selected = instances.business_for_publication(root, records, publication.relative_to(root).as_posix())
            self.assertEqual(business.relative_to(root).as_posix(), selected)

    def test_resume_keeps_saved_inputs_and_completes_existing_creation_keylessly(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            business = self.fixture(root)
            _, request, action = instances.prepare(root, APP, "ui/deploy")
            original = dict(request["inputs"])
            (action / "ui").mkdir()
            selection = instances.load_selection(root)
            selection["business"] = "unrelated.json"
            instances.write_json(root / "instance.json", selection)
            _, resumed, same_action = instances.prepare(root, APP, "ui/deploy")
            self.assertEqual(action, same_action)
            self.assertEqual(original, resumed["inputs"])
            arguments = instances.arguments(root, APP, resumed, action, str(root))
            self.assertEqual("escrow/release/ui/artifact", arguments[0])
            self.assertIn(f"CONTRACT_ARTIFACT={business}", arguments)
            self.assertIn(f"UI_RECORDS={action / 'ui'}", arguments)

    def test_independent_ui_deployment_does_not_change_published_selection(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            self.fixture(root)
            instances.write_json(root / "instance.json", {"config": "config.json", "publication": "original.json"})
            _, request, action = instances.prepare(root, APP, "ui/deploy")
            artifact(root, (action / "ui/artifact/ui-deployment.json").relative_to(root), "cam.ui-deployment.v1")
            instances.finish(root, request, action)
            selected = instances.load_selection(root)
            self.assertEqual("original.json", selected["publication"])
            self.assertNotIn("pending", selected)

    def test_historical_verification_cannot_rewind_or_erase_pending_update(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "updates/old"
            artifact(root, "updates/old/cam/artifact/cam-publication.json", "cam.publication.v1")
            save(root, "updates/old/selection.json", {"operation": "ui/update", "inputs": {"CONFIG": "config.json", "CONTRACT_ARTIFACT": "old-business.json"}})
            current = {"config": "config.json", "publication": "new-publication.json", "pending": "updates/new"}
            instances.write_json(root / "instance.json", current)
            request = instances.read_json(old / "selection.json")
            instances.finish(root, {**request, "requestedOperation": "verify"}, old)
            self.assertEqual(current, instances.load_selection(root))

    def test_failure_or_hosting_pause_does_not_promote_current_refs(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            self.fixture(root)
            _, request, action = instances.prepare(root, APP, "ui/update")
            artifact(root, (action / "ui/artifact/ui-deployment.json").relative_to(root), "cam.ui-deployment.v1")
            instances.finish(root, request, action)
            self.assertEqual(action.relative_to(root).as_posix(), instances.load_selection(root)["pending"])
            self.assertNotIn("publication", instances.load_selection(root))

    def test_saved_request_cannot_escape_instance_or_supply_arbitrary_make_options(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for inputs in ({"CONFIG": "/outside.json"}, {"CONFIG": "../outside.json"}, {"SHELL": "/bin/false"}):
                with self.subTest(inputs=inputs), self.assertRaises(ValueError):
                    instances.arguments(root, APP, {"operation": "deploy", "inputs": inputs}, root / "deployments/one", str(root))
            save(root, "real.json", {})
            (root / "link.json").symlink_to(root / "real.json")
            with self.assertRaisesRegex(ValueError, "symlink"):
                instances.instance_path(root, "link.json")

    def test_setup_records_role_reference_without_copying_configuration_values(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", return_value="ui-config.json"):
            root = Path(directory)
            save(root, "config.json", {"rpcUrl": "https://private.example", "deployerPrivateKey": "private fixture"})
            _, request, action = instances.prepare(root, APP, "setup")
            self.assertEqual("ui-config.json", request["inputs"]["CONFIG"])
            instances.finish(root, request, action)
            self.assertEqual({"config": "config.json", "uiConfig": "ui-config.json"}, instances.load_selection(root))
            self.assertNotIn("private fixture", (root / "instance.json").read_text())

    def test_new_root_bundle_needs_no_existing_root_input_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            save(root, "config.json", {"app": APP})
            artifact(root, "updates/prepared/cam-bundle/artifact/cam-bundle.json", "cam.bundle.v1")
            _, request, _ = instances.prepare(root, APP, "cam/publish")
            self.assertEqual("new", request["inputs"]["ROOT"])
            self.assertNotIn("ROOT_ARTIFACT", request["inputs"])

    def test_allocation_rejects_symlinked_operation_parents_before_creating_outputs(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as external:
            root, outside = Path(directory), Path(external)
            (root / "updates").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                instances.new_action(root, "ui/update")
            self.assertEqual([], list(outside.iterdir()))

    def test_viewer_uses_publication_only_and_a_stable_instance_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = self.fixture(root)
            selection = {"config": "config.json", "publication": original.relative_to(root).as_posix()}
            instances.write_json(root / "instance.json", selection)
            _, up, action = instances.prepare(root, APP, "viewer/up")
            _, down, _ = instances.prepare(root, APP, "viewer/down")
            up_args = instances.arguments(root, APP, up, action, str(root))
            down_args = instances.arguments(root, APP, down, root, str(root))
            project = next(argument for argument in up_args if argument.startswith("RELEASE_VIEWER_COMPOSE_PROJECT_NAME="))
            self.assertIn(project, down_args)
            self.assertNotIn("CONFIG=", up_args)
            self.assertFalse(any(argument.startswith("OUTPUT_DIR=") for argument in up_args))
            self.assertEqual(selection, instances.load_selection(root))

    def test_explicit_ui_artifact_resolves_reused_ui_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui = artifact(root, "updates/created/ui/artifact/ui-deployment.json", "cam.ui-deployment.v1")
            action = root / "updates/reuse"
            request = {"operation": "ui/update", "requestedOperation": "ui/artifact", "inputs": {"CONFIG": "config.json", "UI_ARTIFACT": ui.relative_to(root).as_posix()}}
            args = instances.arguments(root, APP, request, action, str(root))
            self.assertIn(f"UI_RECORDS={ui.parent.parent}", args)
            self.assertNotIn(f"UI_RECORDS={action / 'ui'}", args)

    def test_standalone_bundle_repair_reuses_inputs_and_never_selects_a_paid_phase(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            self.fixture(root)
            artifact(root, "updates/ui/ui/artifact/ui-deployment.json", "cam.ui-deployment.v1")
            _, original, action = instances.prepare(root, APP, "cam/bundle")
            (action / "cam-bundle").mkdir()
            retained = save(root, (action / "cam-bundle/inputs/configuration.json").relative_to(root), {"sourceCommit": COMMIT})
            save(root, "config.json", {"sourceCommit": "b" * 40})
            _, repaired, same_action = instances.prepare(root, APP, "cam/bundle")
            self.assertEqual(action, same_action)
            self.assertEqual({**original["inputs"], "CONFIG": retained.relative_to(root).as_posix()}, repaired["inputs"])
            args = instances.arguments(root, APP, repaired, action, str(root))
            self.assertEqual("escrow/release/cam/bundle", args[0])
            destination = instances.instance_path(root, repaired["repairOutput"])
            self.assertIn(f"OUTPUT_DIR={destination}", args)
            self.assertFalse(destination.exists(), "the ordinary exporter creates its own fresh output")
            artifact(root, (destination / "artifact/cam-bundle.json").relative_to(root), "cam.bundle.v1")
            instances.finish(root, repaired, action)
            self.assertNotIn("pending", instances.load_selection(root))
            self.assertNotIn("publication", instances.load_selection(root))

    def test_retained_complete_bundle_is_a_candidate_without_repeated_export_or_payment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            action = root / "updates/bundle"
            artifact(root, "updates/bundle/cam-bundle/artifact/cam-bundle.json", "cam.bundle.v1")
            request = {"operation": "cam/bundle", "inputs": {"CONFIG": "config.json"}}
            self.assertEqual([], instances.arguments(root, APP, request, action, str(root)))

    def test_cam_artifact_menu_excludes_keyless_bundle_exports(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice) as select:
            root = Path(directory)
            save(root, "updates/one/selection.json", {"operation": "cam/bundle", "inputs": {"CONFIG": "config.json"}})
            with self.assertRaises(ValueError):
                instances.prepare(root, APP, "cam/artifact")
            self.assertEqual([], select.call_args.args[1])

    def test_displaced_partial_publication_remains_resumable_after_other_work_finishes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            self.fixture(root)
            action = root / "updates/partial"
            request = {"operation": "cam/publish", "inputs": {"CONFIG": "config.json", "CAM_BUNDLE": "updates/bundle/cam-bundle", "ROOT": "new"}}
            save(root, "updates/partial/selection.json", request)
            (action / "cam").mkdir()
            instances.write_json(root / "instance.json", {"config": "config.json"})
            _, resumed, destination = instances.prepare(root, APP, "cam/publish")
            self.assertEqual(action, destination)
            self.assertEqual(request, resumed)
            self.assertEqual("updates/partial", instances.load_selection(root)["pending"])
            args = instances.arguments(root, APP, resumed, destination, str(root))
            self.assertIn(f"CAM_RECORDS={action / 'cam'}", args)
            self.assertEqual([action], [path.parent for path in (root / "updates").glob("*/selection.json")])

    def test_repaired_bundle_history_uses_its_retained_completion_without_full_verification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(instances, "choose", side_effect=first_choice):
            root = Path(directory)
            action = root / "updates/bundle"
            request = {"operation": "cam/bundle", "inputs": {"CONFIG": "config.json", "CAM_BUNDLE": "updates/bundle/bundle-recovery/retained"}}
            save(root, "updates/bundle/selection.json", request)
            artifact(root, "updates/bundle/bundle-recovery/retained/artifact/cam-bundle.json", "cam.bundle.v1")
            selected = {"config": "config.json", "publication": "current.json"}
            instances.write_json(root / "instance.json", selected)
            _, observed, destination = instances.select_saved_work(root, selected, [(action, request)])
            self.assertEqual("verify", observed["requestedOperation"])
            self.assertEqual([], instances.arguments(root, APP, observed, destination, str(root)))
            instances.finish(root, observed, destination)
            self.assertEqual(selected, instances.load_selection(root))
            # Recover interruption after saving the repaired reference but before clearing pending.
            selected["pending"] = action.relative_to(root).as_posix()
            instances.write_json(root / "instance.json", selected)
            instances.finish(root, observed, destination)
            selected.pop("pending")
            self.assertEqual(selected, instances.load_selection(root))

    def test_publication_backing_can_be_the_exact_retained_bundle_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backing = artifact(root, "updates/bundle/cam-bundle/inputs/business.json", "cam.contract-deployment.v1")
            digest = "0x" + hashlib.sha256(backing.read_bytes()).hexdigest()
            publication = artifact(root, "updates/publication/cam/artifact/cam-publication.json", "cam.publication.v1", businessArtifactSha256=digest)
            instances.write_json(root / "instance.json", {"business": backing.relative_to(root).as_posix()})
            self.assertEqual(backing.relative_to(root).as_posix(), instances.business_for_publication(root, instances.inventory(root, APP), publication.relative_to(root).as_posix()))

    def test_ambiguous_choices_need_a_terminal_and_are_not_timestamp_selected(self):
        with patch.object(instances.sys.stdin, "isatty", return_value=False):
            with self.assertRaisesRegex(ValueError, "interactive"):
                instances.choose("records", [("older", "a"), ("newer", "b")], automatic=True)


if __name__ == "__main__":
    unittest.main()
