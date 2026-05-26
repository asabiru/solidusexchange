<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SendNotificationMail extends Mailable
{
    use Queueable, SerializesModels;

    public $theme;
    public $logo;
    public $emailMessage;
    public $notification;
    public $url;
    public $urlName;

    /**
     * Create a new message instance.
     */
    public function __construct($message, $notification, $url = null, $urlName = null)
    {
        $this->theme = template();
        $this->logo = getFile(basicControl()->logo_driver, basicControl()->logo);
        $this->emailMessage = $message;
        $this->notification = $notification;
        $this->url = $url;
        $this->urlName = $urlName;
    }

    public function build()
    {
        $mailMessage = $this->subject($this->emailMessage)
            ->from(basicControl()->sender_email, basicControl()->sender_email_name);

        $mailMessage->view($this->theme . 'user.mail.notifyMail', [
            'emailAddress' => $this->notification->email_address,
            'emailMessage' => $this->emailMessage,
            'date' => dateTime($this->notification->created_at, basicControl()->date_time_format),
            'logo' => $this->logo,
            'url' => $this->url,
            'urlName' => $this->urlName,
        ]);
    }
}
