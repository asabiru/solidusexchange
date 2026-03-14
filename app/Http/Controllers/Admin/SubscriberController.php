<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Mail\SendMail;
use App\Models\Subscribe;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;


class SubscriberController extends Controller
{

    public function index()
    {
        $data['subscribers'] = Subscribe::paginate(basicControl()->paginate);
        return view('admin.subscriber.list', $data);
    }


    public function store(Request $request)
    {
        try {
            $request->validate([
                'email' => 'required|email|string|max:255|unique:subscribes',
            ]);

            $subscriber = new Subscribe();
            $subscriber->email = $request->input('email');
            $subscriber->save();
            return back()->with('success', 'You Have Subscribed Successfully');
        } catch (\Exception $e) {
            return back()->with('error', $e->getMessage());
        }
    }


    public function destroy($id)
    {
        $data = Subscribe::findOrFail($id);
        $data->delete();

        return back()->with('success', ' Subscriber deleted successfully ');
    }


    public function sendEmailForm()
    {
        $page_title = 'Send Email to Subscribers';
        return view('admin.subscriber.send_email', compact('page_title'));
    }

    public function sendEmail(Request $request)
    {

        $rules = [
            'subject' => 'required',
            'description' => 'required',
        ];

        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return back()->withErrors($validator)->withInput();
        }
        $basic = basicControl();
        $email_from = $basic->sender_email;
        $requestMessage = $request->message;
        $subject = $request->subject;
        $email_body = $basic->email_description;
        if (!Subscribe::first()) return back()->withInput()->with('error', 'No subscribers to send email.');
        $subscribers = Subscribe::all();
        foreach ($subscribers as $subscriber) {
            $name = explode('@', $subscriber->email)[0];
            $message = str_replace("[[name]]", $name, $email_body);
            $message = str_replace("[[message]]", $requestMessage, $message);
            @Mail::to($subscriber->email)->queue(new SendMail($email_from, $subject, $message));
        }
        return back()->with('success', 'Email has been sent to subscribers.');
    }

}
