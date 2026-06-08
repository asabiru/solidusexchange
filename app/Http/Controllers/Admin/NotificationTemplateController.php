<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Language;
use App\Models\NotificationTemplate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Facades\App\Services\BasicService;

class NotificationTemplateController extends Controller
{

    public function defaultTemplate(Request $request)
    {

        $basicControl = basicControl();
        if ($request->isMethod('get')) {
            return view('admin.notification_templates.email_template.default', compact('basicControl'));
        } elseif ($request->isMethod('post')) {

            $request->validate([
                'sender_email' => 'required|email:rfc,dns',
                'sender_email_name' => 'required',
                'email_description' => 'required',
            ]);

            $basicControl->update([
                'sender_email' => $request->sender_email,
                'sender_email_name' => $request->sender_email_name,
                'email_description' => $request->email_description
            ]);

            $env = [
                'MAIL_FROM_ADDRESS' => $basicControl->sender_email
            ];

            BasicService::setEnv($env);

            return back()->with('success', 'Email Updated Successfully');

        }
    }

    public function emailTemplates()
    {
        $emailTemplates = NotificationTemplate::select('id', 'language_id', 'name', 'template_key', 'status')->get()->unique('template_key');
        return view('admin.notification_templates.email_template.index', compact('emailTemplates'));
    }

    public function editEmailTemplate($id)
    {
        try {
            $data['languages'] = Language::get();
            $data["template"] = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $templateKey = $data["template"]->template_key;
            $templates = NotificationTemplate::where('template_key', $templateKey)->get();
            return view('admin.notification_templates.email_template.edit', $data, compact('templates'));

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage());
        }
    }

    public function updateEmailTemplate(Request $request, $id, $language_id)
    {
        $validator = Validator::make($request->all(), [
            'name.*' => 'required|string|max:255',
            'subject.*' => 'required|string|max:5000',
            'email_from.*' => 'required|string|max:100',
            'email_template.*' => 'required|string',
            'mail_status' => 'nullable|integer|in:0,1'
        ], [
            'name.*.required' => 'The subject field is required.',
            'name.*.string' => 'The subject must be a string.',
            'name.*.max' => 'The subject may not be greater than 255.',
            'subject.*.required' => 'The subject field is required.',
            'email_from.*.required' => 'The mail from field is required.',
            'email_template.*.required' => 'The message field is required.',
        ]);

        $request['language_id'] = $language_id;

        if ($validator->fails()) {
            return back()->withInput($request->all())->withErrors($validator->getMessageBag());
        }

        try {

            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $status = [];
            if ($template->status) {
                foreach ($template->status as $key => $oldStatus) {
                    if ($key == 'mail') {
                        $status[$key] = $request->mail_status;
                    } else {
                        $status[$key] = $oldStatus;
                    }
                }
            }

            $response = $template->updateOrCreate([
                'language_id' => $language_id,
                'template_key' => $template->template_key,
            ], [
                'name' => $request->name[$language_id] ?? null,
                'template_key' => $template->template_key,
                'subject' => $request->subject[$language_id] ?? null,
                'email_from' => $request->email_from[$language_id] ?? null,
                'short_keys' => $template->short_keys,
                'email' => $request->email_template[$language_id] ?? null,
                'status' => $status,
                'lang_code' => $template->lang_code
            ]);

            throw_if(!$response, 'Something went wrong. Please try again later.');

            return back()->with('success', 'Email template has been updated successfully.')->withInput($request->all());

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage())->withInput($request->all());
        }
    }


    public function smsTemplates()
    {
        $smsTemplates = NotificationTemplate::select('id', 'language_id', 'name', 'template_key', 'status')->get()->unique('template_key');
        return view('admin.notification_templates.sms_template.index', compact('smsTemplates'));
    }

    public function editSmsTemplate($id)
    {
        try {
            $languages = Language::get();
            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $templateKey = $template->template_key;
            $templates = NotificationTemplate::where('template_key', $templateKey)->get();


            return view('admin.notification_templates.sms_template.edit', compact('template', 'languages', 'templates'));

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage());
        }
    }

    public function updateSmsTemplate(Request $request, $id, $language_id)
    {

        $validator = Validator::make($request->all(), [
            'name.*' => 'required|string|max:255',
            'sms_template.*' => 'required|string',
            'sms_status' => 'nullable|integer|in:0,1'
        ], [
            'name.*.required' => 'The subject field is required.',
            'name.*.string' => 'The subject must be a string.',
            'name.*.max' => 'The subject may not be greater than 255.',
            'sms_template.*.required' => 'The message field is required.',
        ]);

        $request['language_id'] = $language_id;


        if ($validator->fails()) {
            return back()->withInput($request->all())->withErrors($validator->getMessageBag());
        }

        try {

            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $status = [];
            if ($template->status) {
                foreach ($template->status as $key => $oldStatus) {
                    if ($key == 'sms') {
                        $status[$key] = $request->sms_status;
                    } else {
                        $status[$key] = $oldStatus;
                    }
                }
            }

            $response = $template->updateOrCreate([
                'language_id' => $language_id,
            ], [
                'name' => $request->name[$language_id] ?? null,
                'template_key' => $template->template_key,
                'short_keys' => $template->short_keys,
                'sms' => $request->sms_template[$language_id] ?? null,
                'status' => $status,
                'lang_code' => $template->lang_code
            ]);

            throw_if(!$response, 'Something went wrong. Please try again later.');

            return back()->with('success', 'SMS template has been updated successfully.')->withInput($request->all());

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage())->withInput($request->all());
        }
    }


    public function inAppNotificationTemplates()
    {
        $templates = NotificationTemplate::select('id', 'language_id', 'name', 'template_key', 'status')->get()->unique('template_key');;
        return view('admin.notification_templates.in_app_notification_template.index', compact('templates'));
    }

    public function editInAppNotificationTemplate($id)
    {
        try {
            $languages = Language::get();

            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $templateKey = $template->template_key;
            $templates = NotificationTemplate::where('template_key', $templateKey)->get();

            return view('admin.notification_templates.in_app_notification_template.edit', compact('template', 'languages', 'templates'));

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage());
        }

    }

    public function updateInAppNotificationTemplate(Request $request, $id, $language_id)
    {

        $validator = Validator::make($request->all(), [
            'name.*' => 'required|string|max:255',
            'in_app_notification_template.*' => 'required|string',
            'in_app_status' => 'nullable|integer|in:0,1'
        ], [
            'name.*.required' => 'The subject field is required.',
            'name.*.string' => 'The subject must be a string.',
            'name.*.max' => 'The subject may not be greater than 255.',
            'in_app_notification_template.*.required' => 'The message field is required.',
        ]);

        $request['language_id'] = $language_id;

        if ($validator->fails()) {
            return back()->withInput($request->all())->withErrors($validator->getMessageBag());
        }

        try {
            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $status = [];
            if ($template->status) {
                foreach ($template->status as $key => $oldStatus) {
                    if ($key == 'in_app') {
                        $status[$key] = $request->in_app_status;
                    } else {
                        $status[$key] = $oldStatus;
                    }
                }
            }

            $response = $template->updateOrCreate([
                'language_id' => $language_id,
            ], [
                'name' => $request->name[$language_id] ?? null,
                'template_key' => $template->template_key,
                'short_keys' => $template->short_keys,
                'in_app' => $request->in_app_notification_template[$language_id] ?? null,
                'status' => $status,
                'lang_code' => $template->lang_code
            ]);


            throw_if(!$response, 'Something went wrong. Please try again later.');

            return back()->with('success', 'In App Notification template has been updated successfully.')->withInput($request->all());

        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage())->withInput($request->all());
        }
    }

    public function pushNotificationTemplates()
    {
        $templates = NotificationTemplate::select('id', 'language_id', 'name', 'template_key', 'status')->get()->unique('template_key');;
        return view('admin.notification_templates.push_notification_template.index', compact('templates'));
    }

    public function editPushNotificationTemplate($id)
    {
        try {
            $languages = Language::get();

            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $templateKey = $template->template_key;
            $templates = NotificationTemplate::where('template_key', $templateKey)->get();

            return view('admin.notification_templates.push_notification_template.edit', compact('template', 'languages', 'templates'));


        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage());
        }

    }

    public function updatePushNotificationTemplate(Request $request, $id, $language_id)
    {

        $validator = Validator::make($request->all(), [
            'name.*' => 'required|string|max:255',
            'push_notification_template.*' => 'required|string',
            'push_status' => 'nullable|integer|in:0,1'
        ], [
            'name.*.required' => 'The subject field is required.',
            'name.*.string' => 'The subject must be a string.',
            'name.*.max' => 'The subject may not be greater than 255.',
            'push_notification_template.*.required' => 'The message field is required.',
        ]);

        $request['language_id'] = $language_id;

        if ($validator->fails()) {
            return back()->withInput($request->all())->withErrors($validator->getMessageBag());
        }

        try {
            $template = NotificationTemplate::where('id', $id)->firstOr(function () {
                throw new \Exception('No template found.');
            });

            $status = [];
            if ($template->status) {
                foreach ($template->status as $key => $oldStatus) {
                    if ($key == 'push') {
                        $status[$key] = $request->push_status;
                    } else {
                        $status[$key] = $oldStatus;
                    }
                }
            }

            $response = $template->updateOrCreate([
                'language_id' => $language_id,
            ], [
                'name' => $request->name[$language_id] ?? null,
                'template_key' => $template->template_key,
                'short_keys' => $template->short_keys,
                'in_app' => $request->push_notification_template[$language_id] ?? null,
                'status' => $status,
                'lang_code' => $template->lang_code

            ]);

            throw_if(!$response, 'Something went wrong. Please try again later.');

            return back()->with('success', 'Push Notification template has been updated successfully.')->withInput($request->all());
        } catch (\Exception $exception) {
            return back()->with('alert', $exception->getMessage())->withInput($request->all());
        }

    }

}
